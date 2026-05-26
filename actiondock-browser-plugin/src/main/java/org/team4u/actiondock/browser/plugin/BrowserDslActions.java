package org.team4u.actiondock.browser.plugin;

import org.team4u.actiondock.plugin.api.ScriptPluginContext;

import java.util.Map;

final class BrowserDslActions implements BrowserActionRegistrar {
    private final BrowserDslSessions sessions;
    private final BrowserDslTabs tabs;
    private final BrowserDslPageActions pageActions;
    private final BrowserDslReadActions readActions;
    private final BrowserDslWaitActions waitActions;
    private final BrowserDslSessionActions sessionActions;
    private final BrowserDslCaptureActions captureActions;
    private final BrowserDslDialogActions dialogActions;
    private final BrowserDslStateActions stateActions;
    private final BrowserDslNetworkActions networkActions;
    private final BrowserDslEvalActions evalActions;
    private final BrowserDslBatchActions batchActions;

    BrowserDslActions(BrowserGatewayService service) {
        BrowserDslTargets targets = new BrowserDslTargets();
        this.sessions = new BrowserDslSessions(service);
        this.tabs = new BrowserDslTabs();
        this.pageActions = new BrowserDslPageActions(service, targets, tabs);
        this.readActions = new BrowserDslReadActions(service, targets, tabs);
        this.waitActions = new BrowserDslWaitActions(service, targets, tabs);
        this.sessionActions = new BrowserDslSessionActions(service, sessions, tabs);
        this.captureActions = new BrowserDslCaptureActions(service, targets, tabs);
        this.dialogActions = new BrowserDslDialogActions(service, tabs);
        this.stateActions = new BrowserDslStateActions(service, tabs);
        this.networkActions = new BrowserDslNetworkActions(service, tabs);
        this.evalActions = new BrowserDslEvalActions(service, targets, tabs);
        this.batchActions = new BrowserDslBatchActions();
        this.batchActions.setActions(this);
    }

    @Override
    public void registerTo(BrowserActionRegistry registry) {
        for (String action : BrowserActionSpecs.actionNames()) {
            if ("capabilities".equals(action)) {
                registry.register(action, (context, args) -> BrowserActionSpecs.capabilities());
            } else if ("batch".equals(action)) {
                registry.register(action, batchActions::batch);
            } else {
                registry.register(action, (context, args) -> invoke(action, context, args));
            }
        }
    }

    Object invoke(String action, ScriptPluginContext context, Map<String, Object> args) throws Exception {
        return switch (action) {
            case "open" -> open(context, args);
            case "snapshot" -> pageActions.snapshot(context(context, args));
            case "click" -> pageActions.click(context(context, args));
            case "dblclick" -> pageActions.dblclick(context(context, args));
            case "fill" -> pageActions.fill(context(context, args));
            case "type" -> pageActions.type(context(context, args));
            case "press" -> pageActions.press(context(context, args));
            case "hover" -> pageActions.hover(context(context, args));
            case "focus" -> pageActions.focus(context(context, args));
            case "clear" -> pageActions.clear(context(context, args));
            case "select" -> pageActions.select(context(context, args));
            case "check" -> pageActions.check(context(context, args));
            case "uncheck" -> pageActions.uncheck(context(context, args));
            case "upload" -> pageActions.upload(context(context, args));
            case "drag" -> pageActions.drag(context(context, args));
            case "scrollIntoView" -> pageActions.scrollIntoView(context(context, args));
            case "reload" -> pageActions.reload(context(context, args));
            case "back" -> pageActions.back(context(context, args));
            case "forward" -> pageActions.forward(context(context, args));
            case "findClick" -> pageActions.findClick(context(context, args));
            case "findFill" -> pageActions.findFill(context(context, args));
            case "findType" -> pageActions.findType(context(context, args));
            case "findHover" -> pageActions.findHover(context(context, args));
            case "findFocus" -> pageActions.findFocus(context(context, args));
            case "findCheck" -> pageActions.findCheck(context(context, args));
            case "findUncheck" -> pageActions.findUncheck(context(context, args));
            case "findText" -> pageActions.findText(context(context, args));
            case "getText" -> readActions.getText(context(context, args));
            case "getHtml" -> readActions.getHtml(context(context, args));
            case "getValue" -> readActions.getValue(context(context, args));
            case "getAttr" -> readActions.getAttr(context(context, args));
            case "getTitle" -> readActions.getTitle(context(context, args));
            case "getUrl" -> readActions.getUrl(context(context, args));
            case "getCount" -> readActions.getCount(context(context, args));
            case "getBox" -> readActions.getBox(context(context, args));
            case "isVisible" -> readActions.isVisible(context(context, args));
            case "isEnabled" -> readActions.isEnabled(context(context, args));
            case "isChecked" -> readActions.isChecked(context(context, args));
            case "waitForElement" -> waitActions.waitForElement(context(context, args));
            case "waitForText" -> waitActions.waitForText(context(context, args));
            case "waitForUrl" -> waitActions.waitForUrl(context(context, args));
            case "waitForLoad" -> waitActions.waitForLoad(context(context, args));
            case "waitForFunction" -> waitActions.waitForFunction(context(context, args));
            case "waitForRequest" -> waitActions.waitForRequest(context(context, args));
            case "waitForResponse" -> waitActions.waitForResponse(context(context, args));
            case "waitForConsole" -> waitActions.waitForConsole(context(context, args));
            case "waitForPopup" -> waitActions.waitForPopup(context(context, args));
            case "waitForDownload" -> waitActions.waitForDownload(context(context, args));
            case "waitForTimeout" -> waitActions.waitForTimeout(context(context, args));
            case "tabList" -> sessionActions.tabList(context(context, args));
            case "tabNew" -> sessionActions.tabNew(context(context, args));
            case "tabSwitch" -> sessionActions.tabSwitch(context(context, args));
            case "tabClose" -> sessionActions.tabClose(context(context, args));
            case "tabBringToFront" -> sessionActions.tabBringToFront(context(context, args));
            case "sessionInfo" -> sessionActions.sessionInfo(context(context, args));
            case "sessionList" -> sessionActions.sessionList(context(context, args));
            case "sessionClose" -> sessionActions.sessionClose(context(context, args));
            case "screenshot" -> captureActions.screenshot(context(context, args));
            case "pdf" -> captureActions.pdf(context(context, args));
            case "dialogList" -> dialogActions.dialogList(context(context, args));
            case "dialogAccept" -> dialogActions.dialogAccept(context(context, args));
            case "dialogDismiss" -> dialogActions.dialogDismiss(context(context, args));
            case "cookiesList" -> stateActions.cookiesList(context(context, args));
            case "cookiesSet" -> stateActions.cookiesSet(context(context, args));
            case "cookiesClear" -> stateActions.cookiesClear(context(context, args));
            case "storageState" -> stateActions.storageState(context(context, args));
            case "storageGet" -> stateActions.storageGet(context(context, args));
            case "storageSet" -> stateActions.storageSet(context(context, args));
            case "storageClear" -> stateActions.storageClear(context(context, args));
            case "networkRequest" -> networkActions.networkRequest(context(context, args));
            case "networkRoute" -> networkActions.networkRoute(context(context, args));
            case "networkUnroute" -> networkActions.networkUnroute(context(context, args));
            case "networkOffline" -> networkActions.networkOffline(context(context, args));
            case "networkHeaders" -> networkActions.networkHeaders(context(context, args));
            case "networkEvents" -> networkActions.networkEvents(context(context, args));
            case "eval" -> evalActions.eval(context(context, args));
            case "batch" -> batchActions.batch(context, args);
            case "capabilities" -> BrowserActionSpecs.capabilities();
            default -> throw new IllegalArgumentException("Unsupported browser action: " + action);
        };
    }

    private Map<String, Object> open(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        String session = sessions.sessionName(args);
        String sessionId = sessions.open(context, args, Args.optionalBoolean(args, "fresh", false));
        BrowserDslContext dsl = new BrowserDslContext(context, args, session, sessionId, tabs.pageId(context, session, args));
        return pageActions.open(dsl);
    }

    private BrowserDslContext context(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        String session = sessions.sessionName(args);
        String sessionId = sessions.resolveRequired(context, args);
        return new BrowserDslContext(context, args, session, sessionId, tabs.pageId(context, session, args));
    }
}
