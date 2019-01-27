import {TestContext} from 'ava';
import {Window} from 'hadouken-js-adapter';

import {getConnection} from './provider/utils/connect';
import {executeJavascriptOnService} from './demo/utils/serviceUtils';
import {WindowInfo, WindowDetail} from 'hadouken-js-adapter/out/types/src/api/system/window';
import {delay} from './provider/utils/delay';

/**
 * Util function to completely reset the desktop in-between test runs.
 * 
 * This should be added as a `test.afterEach.always` hook in EVERY ava test file.
 * 
 * Any left-over state will cause the previous test to fail, but this state will be clean-ed-up so that it does not
 * impact the next test to run.
 * 
 * @param t Test context
 */
export async function teardown(t: TestContext): Promise<void> {
    const fin = await getConnection();

    await closeAllWindows(t);
    await resetProviderState(t);
    
    fin.InterApplicationBus.removeAllListeners();
    
    const msg = await executeJavascriptOnService(function(this: ProviderWindow) {
        const m = this.model;
        const lengths = [m.windows.length, Object.keys(m['_windowLookup']).length, m.snapGroups.length, m.tabGroups.length];

        if (lengths.some(l => l > 0)) {
            return `Clean-up may have failed. Debug info: ${lengths.join(" ")}\n${m.windows.map(w => w.id).join(', ')}\n${m.snapGroups.map(g => `${g.id}${g.entities.map(w => w.id).join(',')}`).join(', ')}\n${m.tabGroups.map(g => `${g.id}${g.tabs.map(w => w.id).join(',')}`).join(', ')}`;
        } else {
            return null;
        }
    });
    if (msg) {
        console.log(msg);
    }
}

async function closeAllWindows(t: TestContext): Promise<void> {
    const fin = await getConnection();

    // Fetch all open windows
    const windowInfo: WindowInfo[] = await fin.System.getAllWindows();
    const windows: Window[] = windowInfo.reduce<Window[]>((windows: Window[], info: WindowInfo) => {
        windows.push(fin.Window.wrapSync({uuid: info.uuid, name: info.mainWindow.name}));
        info.childWindows.forEach((child: WindowDetail) => {
            windows.push(fin.Window.wrapSync({uuid: info.uuid, name: child.name}));
        });

        return windows;
    }, []);

    // Look for any windows that should no longer exist
    const windowIsVisible: boolean[] = await Promise.all(windows.map(w => w.isShowing().catch((e) => {
        console.warn(`isShowing request failed for ${w.identity.uuid}/${w.identity.name}:`, e);
        return false;
    })));
    const invalidWindows: Window[] = windows.filter((window: Window, index: number) => {
        const {uuid, name} = window.identity;

        if (uuid === 'testApp') {
            // Main window persists, but close any child windows
            return name !== uuid;
        } else if(uuid === 'layouts-service') {
            if (name === uuid || name === 'previewWindow') {
                // Main window and preview window persist
                return false;
            } else if (name!.startsWith('TABSET-')) {
                // Allow pooled tabstrips to persist, but destroy any broken/left-over tabstrips
                // Will assume that any invisible tabstrips are pooled
                return windowIsVisible[index];
            } else {
                // Any other service windows (S&R placeholders, etc) should get cleaned-up
                return false;
            }
        } else {
            // All other applications should get cleaned-up
            return true;
        }
    });

    if (invalidWindows.length > 0) {
        await Promise.all(invalidWindows.map((w: Window) => w.close(true).catch((e) => {
            console.warn(`Window close failed (ignoring) ${w.identity.uuid}/${w.identity.name}:`, e);
        })));
        t.fail(`${invalidWindows.length} window(s) left over after test: ${invalidWindows.map(w => `${w.identity.uuid}/${w.identity.name}`).join(", ")}`);
    }
}

async function resetProviderState(t: TestContext): Promise<void> {
    const msg: string|null = await executeJavascriptOnService(function(this: ProviderWindow): string|null {
        const SEPARATOR_LIST = ', ';
        const SEPARATOR_LINE = '\n    ';

        const {windows, snapGroups, tabGroups} = this.model;
        const msgs: string[] = [];

        if (windows.length > 0) {
            msgs.push(`Provider still had ${windows.length} windows registered: ${windows.map(w => w.id).join(SEPARATOR_LIST)}`);
            this.model['_windows'].length = 0;
            this.model['_windowLookup'] = {};
        }
        if (snapGroups.length > 0) {
            const groupInfo = snapGroups.map((s, i) => `${i+1}: ${s.id} (${s.entities.map(e => e.id).join(SEPARATOR_LIST)})`).join(SEPARATOR_LINE);
            
            msgs.push(`Provider still had ${snapGroups.length} snapGroups registered:${SEPARATOR_LINE}${groupInfo}`);
            this.model['_snapGroups'].length = 0;
        }
        if (tabGroups.length > 0) {
            const groupInfo = tabGroups.map((t, i) => `${i+1}: ${t.id} (${t.tabs.map(w => w.id).join(SEPARATOR_LIST)})`).join(SEPARATOR_LINE);

            msgs.push(`WARN: Provider still had ${tabGroups.length} tabGroups registered:${SEPARATOR_LINE}${groupInfo}`);
            this.model['_tabGroups'].length = 0;
        }

        if (msgs.length > 1) {
            return `${msgs.length} issues detected in provider state:${SEPARATOR_LINE}${msgs.map(msg => msg.replace(/\n/g, SEPARATOR_LINE)).join(SEPARATOR_LINE)}`;
        } else if (msgs.length === 1) {
            return msgs[0];
        } else {
            return null;
        }
    });

    if (msg) {
        const isFatal: boolean = msg.split('\n').some(line => {
            return !(line.startsWith('WARN') || line.startsWith('    '));
        });

        // Fail test - unless all messages were warnings
        if (isFatal) {
            t.fail(msg);
        }

        // Wait for clean-up to complete
        await delay(5000);
    }
}
