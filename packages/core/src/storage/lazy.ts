import type { RuntimeStorage } from "./types";

/**
 * 创建延迟初始化的运行时存储代理对象。
 * 只有在首次调用存储的方法或属性时，才会调用底层工厂函数建立真实连接。
 *
 * @param factory 底层存储实例工厂函数
 */
export function createLazyStorage(factory: () => RuntimeStorage): RuntimeStorage {
  let instance: RuntimeStorage | undefined;

  function getInstance(): RuntimeStorage {
    if (!instance) {
      instance = factory();
    }
    return instance;
  }

  return new Proxy({} as RuntimeStorage, {
    get(_target, prop, receiver) {
      if (prop === "closed") {
        return instance ? instance.closed : false;
      }
      if (prop === "isOpen") {
        return instance ? instance.isOpen : false;
      }
      if (prop === "close") {
        return () => {
          if (instance) {
            instance.close();
          }
        };
      }
      if (prop === "__isLazyProxy") {
        return true;
      }
      if (prop === "__getUnderlyingInstance") {
        return getInstance;
      }
      const target = getInstance();
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === "function") {
        return value.bind(target);
      }
      return value;
    },
  });
}
