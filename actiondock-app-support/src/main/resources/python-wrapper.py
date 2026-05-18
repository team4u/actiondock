import json
import os
import sys

class __ActionDockLog:
    def _write(self, level, message):
        payload = json.dumps({"level": level, "message": str(message)}, ensure_ascii=False)
        sys.stderr.write("__ACTIONDOCK_LOG__" + payload + "\n")
        sys.stderr.flush()

    def debug(self, message):
        self._write("DEBUG", message)

    def info(self, message):
        self._write("INFO", message)

    def warn(self, message):
        self._write("WARN", message)

    def error(self, message):
        self._write("ERROR", message)

log = __ActionDockLog()

class __ActionDockScripts:
    def invoke(self, script_id, args=None):
        payload = json.dumps({"scriptId": script_id, "args": {} if args is None else args}, ensure_ascii=False)
        sys.stderr.write("__ACTIONDOCK_INVOKE__" + payload + "\n")
        sys.stderr.flush()
        response_text = sys.stdin.readline()
        if not response_text:
            raise RuntimeError("Script invocation bridge closed")
        response = json.loads(response_text)
        if response.get("ok"):
            return response.get("result")
        raise RuntimeError(response.get("error") or "Script invocation failed")

scripts = __ActionDockScripts()

class __ActionDockPlugins:
    def invoke(self, plugin_id, action, args=None):
        payload = json.dumps({
            "pluginId": plugin_id,
            "action": action,
            "args": {} if args is None else args
        }, ensure_ascii=False)
        sys.stderr.write("__ACTIONDOCK_PLUGIN__" + payload + "\n")
        sys.stderr.flush()
        response_text = sys.stdin.readline()
        if not response_text:
            raise RuntimeError("Plugin bridge closed")
        response = json.loads(response_text)
        if response.get("ok"):
            return response.get("result")
        raise RuntimeError(response.get("error") or "Plugin invocation failed")

plugins = __ActionDockPlugins()

class __ActionDockState:
    def _request(self, payload):
        sys.stderr.write("__ACTIONDOCK_STATE__" + json.dumps(payload, ensure_ascii=False) + "\n")
        sys.stderr.flush()
        response_text = sys.stdin.readline()
        if not response_text:
            raise RuntimeError("State bridge closed")
        response = json.loads(response_text)
        if response.get("ok"):
            return response.get("result")
        raise RuntimeError(response.get("error") or "State request failed")

    def get(self, namespace, key):
        return self._request({"operation": "get", "namespace": namespace, "key": key})

    def put(self, namespace, key, value, options=None):
        return self._request({"operation": "put", "namespace": namespace, "key": key, "value": value, "options": {} if options is None else options})

    def cas(self, namespace, key, expected_version, value, options=None):
        return self._request({"operation": "cas", "namespace": namespace, "key": key, "expectedVersion": expected_version, "value": value, "options": {} if options is None else options})

    def delete(self, namespace, key):
        return self._request({"operation": "delete", "namespace": namespace, "key": key})

    def list(self, namespace):
        return self._request({"operation": "list", "namespace": namespace})

state = __ActionDockState()

def __actiondock_main(input):
{{ user_script }}
