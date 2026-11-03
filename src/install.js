const IOS_BROWSERS=/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|GSA\//i;
const IN_APP_BROWSERS=/Line\/|FBAN|FBAV|Instagram|MicroMessenger|Twitter|TikTok/i;
const ANDROID_ALTERNATIVES=/EdgA?\/|OPR\/|SamsungBrowser|Firefox\/|DuckDuckGo|YaBrowser|MiuiBrowser/i;

export function isStandalone(navigatorLike=globalThis.navigator,windowLike=globalThis.window){
  return Boolean(navigatorLike?.standalone===true||windowLike?.matchMedia?.('(display-mode: standalone)')?.matches);
}

export function detectInstallEnvironment({userAgent=globalThis.navigator?.userAgent||'',platform=globalThis.navigator?.platform||'',maxTouchPoints=globalThis.navigator?.maxTouchPoints||0}={}){
  const ios=/iPhone|iPad|iPod/i.test(userAgent)||(/MacIntel/i.test(platform)&&maxTouchPoints>1);
  const inApp=IN_APP_BROWSERS.test(userAgent);
  const iosSafari=ios&&!inApp&&!IOS_BROWSERS.test(userAgent)&&/Safari/i.test(userAgent);
  const android=/Android/i.test(userAgent);
  const androidChrome=android&&!inApp&&!ANDROID_ALTERNATIVES.test(userAgent)&&/Chrome\/\d+/i.test(userAgent);
  return {ios,android,inApp,iosSafari,androidChrome};
}
