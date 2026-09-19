const dom = (globalThis as unknown as { jsdom?: { window?: { localStorage?: Storage; sessionStorage?: Storage } } }).jsdom
if (dom?.window?.localStorage) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: dom.window.localStorage,
    configurable: true,
    writable: true,
  })
}
if (dom?.window?.sessionStorage) {
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: dom.window.sessionStorage,
    configurable: true,
    writable: true,
  })
}

