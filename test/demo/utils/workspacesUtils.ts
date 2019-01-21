import {Context, GenericTestContext, Test, TestContext} from 'ava';

import {SERVICE_IDENTITY} from '../../../src/client/internal';
import {Layout} from '../../../src/client/types';
import {getConnection} from '../../provider/utils/connect';

import {AppInitializerParams, createAppsArray, createWindowGroupings, TestAppData, WindowGrouping} from './AppInitializer';
import {AppContext} from './createAppTest';
import {sendServiceMessage} from './serviceUtils';

type SaveRestoreTestContext = GenericTestContext<Context<AppContext>>;

async function isWindowActive(uuid: string, name: string) {
    const fin = await getConnection();
    const allWindows = await fin.System.getAllWindows();

    return allWindows.some(win => {
        if (win.uuid !== uuid) {
            return false;
        } else if (uuid === name) {
            return true;
        } else {
            return win.childWindows.some(childWin => childWin.name === name);
        }
    });
}

export async function assertWindowRestored(t: TestContext, uuid: string, name: string) {
    const active = await isWindowActive(uuid, name);
    active ? t.pass() : t.fail(`Window ${uuid}:${name} was not restored`);
}

export async function assertWindowNotRestored(t: TestContext, uuid: string, name: string) {
    const active = await isWindowActive(uuid, name);
    active ? t.fail(`Window ${uuid}:${name} was restored when it should not have been`) : t.pass();
}

function assertIsLayoutObject(t: SaveRestoreTestContext, layout: Layout) {
    layout.type === 'layout' ? t.pass() : t.fail('Layout object has an incorrect type!');
}

async function assertAllAppsClosed(t: SaveRestoreTestContext) {
    t.context.testAppData.forEach(async (appData: TestAppData) => {
        const appRunning = await appData.app.isRunning();
        if (appRunning) {
            t.fail(`Application ${appData.uuid} is running, but it should have been closed.`);
            return;
        }
    });
}

export async function createCloseAndRestoreLayout(t: SaveRestoreTestContext) {
    const generatedLayout = await sendServiceMessage('generateLayout', undefined) as Layout;
    assertIsLayoutObject(t, generatedLayout);
    await Promise.all(t.context.testAppData.map(async (appData: TestAppData) => await appData.app.close(true)));
    await assertAllAppsClosed(t);
    await sendServiceMessage('restoreLayout', generatedLayout);
}

export function createBasicSaveAndRestoreTest(numAppsToCreate: number, numberOfChildren: number): {apps: AppInitializerParams[]} {
    const appsArray = createAppsArray(numAppsToCreate, numberOfChildren);

    return {apps: appsArray as AppInitializerParams[]};
}

export function createSnapTests(numApps: number, children: number): {apps: AppInitializerParams[], snapWindowGrouping: WindowGrouping}[] {
    const windowGroupings = createWindowGroupings(numApps, children);
    const appsArray = createAppsArray(numApps, children);

    return windowGroupings.map(windowGrouping => {
        return {apps: appsArray as AppInitializerParams[], snapWindowGrouping: windowGrouping};
    });
}

export function createTabTests(numApps: number, children: number): {apps: AppInitializerParams[], tabWindowGrouping: WindowGrouping}[] {
    const windowGroupings = createWindowGroupings(numApps, children);
    const appsArray = createAppsArray(numApps, children);

    return windowGroupings.map(windowGrouping => {
        return {apps: appsArray as AppInitializerParams[], tabWindowGrouping: windowGrouping};
    });
}

export async function closeAllPreviews(t: TestContext): Promise<void> {
    const serviceApp = fin.Application.wrapSync(SERVICE_IDENTITY);
    const children = await serviceApp.getChildWindows();
    const actions: Promise<void>[] = [];
    for (const child of children) {
        if (child.identity.name!.startsWith('Placeholder-')) {
            t.fail('Placeholder still exists after save/restore: ' + child.identity.name);
            actions.push(child.close());
        }
    }
    return Promise.all(actions).then(() => {});
}