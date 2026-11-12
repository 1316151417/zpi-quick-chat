#import <AppKit/AppKit.h>
#include <node_api.h>

static id outsideMouseMonitor;
static id activationObserver;
static uint64_t outsideEventCount;

static void stopFocusWatch(void *data) {
  if (outsideMouseMonitor) [NSEvent removeMonitor:outsideMouseMonitor];
  if (activationObserver) [NSWorkspace.sharedWorkspace.notificationCenter removeObserver:activationObserver];
  outsideMouseMonitor = nil;
  activationObserver = nil;
}

static BOOL checked(napi_env env, napi_status status) {
  if (status == napi_ok) return YES;
  bool pending = false;
  napi_is_exception_pending(env, &pending);
  if (!pending) napi_throw_error(env, NULL, "Native focus operation failed");
  return NO;
}

static void releaseTarget(napi_env env, void *data, void *hint) {
  CFRelease(data);
}

static napi_value returnFocus(napi_env env, napi_callback_info info) {
  void *data = NULL;
  if (!checked(env, napi_get_cb_info(env, info, NULL, NULL, NULL, &data))) return NULL;
  NSRunningApplication *target = (__bridge NSRunningApplication *)data;
  BOOL restored = NO;
  // Do not steal focus if the user already clicked another window, or launch
  // an app that has since quit. Holding the object also avoids PID reuse.
  @try {
    if (NSApp.active && target && !target.terminated) {
      if (@available(macOS 14.0, *)) [NSApp yieldActivationToApplication:target];
      restored = [target activateWithOptions:NSApplicationActivateIgnoringOtherApps];
    }
  } @catch (NSException *exception) {
    napi_throw_error(env, NULL, exception.reason.UTF8String ?: "Unable to return application focus");
    return NULL;
  }
  napi_value result;
  if (!checked(env, napi_get_boolean(env, restored, &result))) return NULL;
  return result;
}

static napi_value activate(napi_env env, napi_callback_info info) {
  napi_value result;
  NSRunningApplication *previous;
  @try {
    previous = NSWorkspace.sharedWorkspace.frontmostApplication;
    [NSApp activateIgnoringOtherApps:YES];
  } @catch (NSException *exception) {
    napi_throw_error(env, NULL, exception.reason.UTF8String ?: "Unable to activate application");
    return NULL;
  }
  if (!previous || previous.processIdentifier == NSProcessInfo.processInfo.processIdentifier) {
    if (!checked(env, napi_get_undefined(env, &result))) return NULL;
    return result;
  }
  void *target = (void *)CFBridgingRetain(previous);
  if (!checked(env, napi_create_function(env, "returnFocus", NAPI_AUTO_LENGTH, returnFocus, target, &result))) {
    CFRelease(target);
    return NULL;
  }
  if (!checked(env, napi_add_finalizer(env, result, target, releaseTarget, NULL, NULL))) {
    CFRelease(target);
    return NULL;
  }
  return result;
}

static napi_value focusLossCount(napi_env env, napi_callback_info info) {
  // Non-activating panels can receive keyboard input while their application is
  // already inactive. Clicking the same external app then emits neither Electron
  // blur nor application-deactivation. Observe those external mouse events too.
  if (!outsideMouseMonitor) {
    outsideMouseMonitor = [NSEvent addGlobalMonitorForEventsMatchingMask:
      NSEventMaskLeftMouseDown | NSEventMaskRightMouseDown | NSEventMaskOtherMouseDown
      handler:^(NSEvent *event) { outsideEventCount++; }];
    if (!outsideMouseMonitor) {
      napi_throw_error(env, NULL, "Unable to observe outside mouse clicks");
      return NULL;
    }
    activationObserver = [NSWorkspace.sharedWorkspace.notificationCenter
      addObserverForName:NSWorkspaceDidActivateApplicationNotification object:nil
      queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *notification) {
        NSRunningApplication *application = notification.userInfo[NSWorkspaceApplicationKey];
        if (application && application.processIdentifier != NSProcessInfo.processInfo.processIdentifier)
          outsideEventCount++;
      }];
    if (!checked(env, napi_add_env_cleanup_hook(env, stopFocusWatch, NULL))) {
      stopFocusWatch(NULL);
      return NULL;
    }
  }
  napi_value result;
  if (!checked(env, napi_create_double(env, (double)outsideEventCount, &result))) return NULL;
  return result;
}

NAPI_MODULE_INIT() {
  napi_value function;
  if (!checked(env, napi_create_function(env, "activate", NAPI_AUTO_LENGTH, activate, NULL, &function))) return NULL;
  if (!checked(env, napi_set_named_property(env, exports, "activate", function))) return NULL;
  if (!checked(env, napi_create_function(env, "focusLossCount", NAPI_AUTO_LENGTH, focusLossCount, NULL, &function))) return NULL;
  if (!checked(env, napi_set_named_property(env, exports, "focusLossCount", function))) return NULL;
  return exports;
}
