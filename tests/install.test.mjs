import assert from 'node:assert/strict';
import test from 'node:test';
import {detectInstallEnvironment,isStandalone} from '../src/install.js';

const iphoneSafari='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const iphoneChrome='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.69 Mobile/15E148 Safari/604.1';
const androidChrome='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

test('standalone detection requires an actual standalone signal',()=>{
 assert.equal(isStandalone({standalone:false},{matchMedia:()=>({matches:false})}),false);
 assert.equal(isStandalone({standalone:true},{}),true);
 assert.equal(isStandalone({}, {matchMedia:query=>({matches:query==='(display-mode: standalone)'})}),true);
});

test('install guidance recognizes Safari and avoids mistaking iOS Chrome for Safari',()=>{
 assert.equal(detectInstallEnvironment({userAgent:iphoneSafari}).iosSafari,true);
 assert.equal(detectInstallEnvironment({userAgent:iphoneChrome}).iosSafari,false);
 assert.equal(detectInstallEnvironment({userAgent:iphoneChrome}).ios,true);
});

test('Android Chrome is supported while other browsers and embedded browsers get fallback guidance',()=>{
 assert.equal(detectInstallEnvironment({userAgent:androidChrome}).androidChrome,true);
 assert.equal(detectInstallEnvironment({userAgent:androidChrome.replace('Chrome/130','SamsungBrowser/27.0 Chrome/130')}).androidChrome,false);
 const line=detectInstallEnvironment({userAgent:androidChrome+' Line/14.0'});
 assert.equal(line.inApp,true);
 assert.equal(line.androidChrome,false);
});

test('iPadOS desktop user agent is recognized using touch support',()=>{
 assert.equal(detectInstallEnvironment({userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',platform:'MacIntel',maxTouchPoints:5}).ios,true);
});
