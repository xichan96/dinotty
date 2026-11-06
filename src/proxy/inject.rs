pub const INJECT_SCRIPT_INTERNAL: &str = r"<script>(function(){
window.parent.postMessage({type:'preview-ready'},'*');
window.parent.postMessage({type:'preview-console',level:'info',args:['[dinotty] inject script loaded'],ts:Date.now()});
window.addEventListener('error',function(e){
window.parent.postMessage({type:'preview-error',message:e.message,source:e.filename,line:e.lineno},'*');
});
var PORT=__DN_PORT__;
var HOST=__DN_HOST__;
var SCHEME=__DN_SCHEME__;
var PREFIX=__DN_PREFIX__;
var APP_PATH=__DN_PATH__;
if(!window.__dinotty_proxy_port){
window.__dinotty_proxy_port=PORT;
window.__dinotty_proxy_host=HOST;
window.__dinotty_proxy_scheme=SCHEME;
window.__dinotty_proxy_prefix=PREFIX;
(function(){var _c={};['log','warn','info','debug','error'].forEach(function(l){_c[l]=console[l];console[l]=function(){_c[l].apply(console,arguments);try{var a=[];for(var i=0;i<arguments.length;i++){var v=arguments[i];if(v instanceof Error)a.push(v.message+'\n'+v.stack);else if(typeof v==='object'){try{a.push(JSON.stringify(v));}catch(e){a.push(String(v));}}else a.push(String(v));}window.parent.postMessage({type:'preview-console',level:l,args:a,ts:Date.now()},'*');}catch(e){}};});var _cl=console.clear;console.clear=function(){_cl.apply(console);try{window.parent.postMessage({type:'preview-console',level:'clear',args:[],ts:Date.now()},'*');}catch(e){}};
window.addEventListener('unhandledrejection',function(e){var m=e.reason?(e.reason.message||String(e.reason)):'Unknown promise rejection';var s=e.reason&&e.reason.stack?e.reason.stack:'';window.parent.postMessage({type:'preview-error',message:m,stack:s,unhandledRejection:true},'*');});
})();
// History-mode SPAs (react-router, vue-router, ...) read location.pathname
// and render a 404 when it carries a proxy prefix. Show them the upstream
// path: the document URL becomes the real app route while every URL the app
// builds still goes through PREFIX via the hooks below. Reloads and hard
// navigations escape this document; the preview shell re-enters them.
(function(){
function clean(s){
if(!s||s.length<2)return '';
var parts=s.slice(1).split('&').filter(function(kv){return kv&&kv.split('=')[0]!=='_t';});
return parts.length?'?'+parts.join('&'):'';
}
try{
history.replaceState(history.state,'',APP_PATH+clean(location.search)+location.hash);
window.__dinotty_virtual_path=true;
}catch(e){}
})();
}
function proxyPrefix(){
return String(PREFIX||'').replace(/\/+$/,'')+'/';
}
function relayPrefix(){
var i=proxyPrefix().indexOf('/preview/');
return i>0?proxyPrefix().slice(0,i):'';
}
function b64url(s){
return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function proxyPrefixFor(host,port,scheme){
host=host||HOST;port=port||PORT;scheme=scheme||SCHEME;
if(host===HOST&&String(port)===String(PORT)&&scheme===SCHEME)return proxyPrefix();
return relayPrefix()+'/preview/'+b64url(scheme+'://'+host+':'+port)+'/';
}
function cleanSearch(s){
if(!s||s.length<2)return '';
var parts=s.slice(1).split('&').filter(function(kv){return kv&&kv.split('=')[0]!=='_t';});
return parts.length?'?'+parts.join('&'):'';
}
function fixAbs(v){
if(typeof v!=='string')return v;
if(/^(?:data:|blob:|javascript:|mailto:|tel:|#)/i.test(v))return v;
var pp=proxyPrefix();
if(v.charAt(0)==='/'&&v.charAt(1)!=='/'){
if(v.indexOf(pp)===0)return v;
return pp+v.slice(1);
}
var up=SCHEME+'://'+HOST+':'+PORT;
if(v.indexOf(up)===0)return pp+v.slice(up.length+1);
if(v.indexOf(location.origin)===0){
var r=v.slice(location.origin.length);
if(r.charAt(0)==='/'&&r.indexOf(pp)!==0)return pp+r.slice(1);}
return v;
}
function rewrite(u){
try{var p=new URL(u,location.href);
var scheme,host,port;
if(p.origin===location.origin){
// The document URL is virtual: a same-origin URL means the app's own
// upstream origin, not Dinotty.
scheme=SCHEME;host=HOST;port=PORT;
}else{
var h=p.hostname;
if(!(h===HOST||h==='127.0.0.1'||h==='localhost'||h==='0.0.0.0'))return null;
scheme=(p.protocol==='https:')?'https':'http';
host=h;
port=p.port||(scheme==='https'?'443':'80');
}
var prefix=proxyPrefixFor(host,port,scheme);
// A URL shim may already have prefixed the path. Keep that form instead of
// dropping the request: returning null would let the caller use the raw
// '/api/...' path, which hits Dinotty's own server.
if(p.pathname.indexOf(prefix)===0)return p.pathname+p.search+p.hash;
return prefix+p.pathname.slice(1)+p.search+p.hash;
}catch(e){}
return null;
}
document.addEventListener('click',function(e){
var a=e.target.closest('a');
if(!a||!a.href)return;
var r=rewrite(a.href);
if(r){e.preventDefault();location.href=r;}
},true);
document.addEventListener('submit',function(e){
var f=e.target;if(!f||!f.action)return;
var r=rewrite(f.action);
if(r){f.action=r;}
},true);
var _open=XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open=function(m,u){this.__dn_m=m;this.__dn_u=u;var r=rewrite(u);return _open.apply(this,[m,r||u].concat([].slice.call(arguments,2)));};
var _send=XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send=function(){var s=performance.now(),x=this;x.addEventListener('loadend',function(){try{window.parent.postMessage({type:'preview-network',method:x.__dn_m||'GET',url:x.__dn_u,status:x.status,duration:Math.round(performance.now()-s),ts:Date.now()},'*');}catch(e){}});return _send.apply(this,arguments);};
var _fetch=window.fetch;
window.fetch=function(u,o){
var url=typeof u==='string'?u:(u instanceof Request?u.url:String(u));
var m=(o&&o.method)||((u instanceof Request)?u.method:'GET')||'GET';
var s=performance.now();
if(typeof u==='string'){var r=rewrite(u);if(r){u=r.startsWith('http')?r:location.origin+r;}}
else if(u instanceof Request){var r2=rewrite(u.url);if(r2){var abs=r2.startsWith('http')?r2:location.origin+r2;u=new Request(abs,u);}}
return _fetch.call(this,u,o).then(function(resp){try{window.parent.postMessage({type:'preview-network',method:m,url:url,status:resp.status,duration:Math.round(performance.now()-s),ts:Date.now()},'*');}catch(e){}return resp;}).catch(function(err){try{window.parent.postMessage({type:'preview-network',method:m,url:url,status:0,duration:Math.round(performance.now()-s),error:true,ts:Date.now()},'*');}catch(e){}throw err;});
};
var _WebSocket=window.WebSocket;
window.WebSocket=function(u,p){
if(typeof u==='string'){
try{var parsed=new URL(u,location.href);
var h=parsed.hostname;
if(h===HOST||h==='127.0.0.1'||h==='localhost'||h==='0.0.0.0'||h===location.hostname){
var scheme=(parsed.protocol==='wss:'||parsed.protocol==='https:')?'https':'http';
var port=parsed.port||(scheme==='https'?'443':'80');
if(h===location.hostname&&(!parsed.port||parsed.port===location.port)){h=HOST;port=PORT;scheme=SCHEME;}
var wsPrefix=proxyPrefixFor(h,port,scheme);
var wsProto=location.protocol==='https:'?'wss:':'ws:';
u=wsProto+'//'+location.host+wsPrefix+parsed.pathname.slice(1)+parsed.search;
}}catch(e){}}
return p!==undefined?new _WebSocket(u,p):new _WebSocket(u);
};
window.WebSocket.prototype=_WebSocket.prototype;
window.WebSocket.CONNECTING=_WebSocket.CONNECTING;
window.WebSocket.OPEN=_WebSocket.OPEN;
window.WebSocket.CLOSING=_WebSocket.CLOSING;
window.WebSocket.CLOSED=_WebSocket.CLOSED;
var _EventSource=window.EventSource;
if(_EventSource){
window.EventSource=function(u,o){
if(typeof u==='string'){var r=rewrite(u);if(r)u=r;}
return new _EventSource(u,o);
};
window.EventSource.prototype=_EventSource.prototype;
window.EventSource.CONNECTING=_EventSource.CONNECTING;
window.EventSource.OPEN=_EventSource.OPEN;
window.EventSource.CLOSED=_EventSource.CLOSED;
}
(function(){
var _RealImage=window.Image;
function _ImageShim(){return _wrapImg(new _RealImage());}
function _wrapImg(img){
var _desc=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
if(!_desc)return img;
Object.defineProperty(img,'src',{get:function(){return _desc.get.call(img);},set:function(v){try{var u=new URL(v,location.href);var pp=proxyPrefix();if(pp&&u.origin===location.origin&&u.pathname.startsWith('/')){v=u.pathname.startsWith(pp)?u.pathname+u.search+u.hash:pp+u.pathname.slice(1)+u.search+u.hash;}}catch(e){}_desc.set.call(img,v);}});
return img;
}
_ImageShim.prototype=_RealImage.prototype;
_ImageShim.prototype.constructor=_ImageShim;
Object.defineProperty(_ImageShim,Symbol.hasInstance,{value:function(o){return o instanceof _RealImage;}});
window.Image=_ImageShim;
var _desc=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
if(_desc&&_desc.set){
var _origSet=_desc.set;
Object.defineProperty(HTMLImageElement.prototype,'src',{get:function(){return _desc.get.call(this);},set:function(v){try{var u=new URL(v,location.href);var pp=proxyPrefix();if(pp&&u.origin===location.origin&&u.pathname.startsWith('/')){v=u.pathname.startsWith(pp)?u.pathname+u.search+u.hash:pp+u.pathname.slice(1)+u.search+u.hash;}}catch(e){}_origSet.call(this,v);}});
}
})();
(function(){
var _desc=Object.getOwnPropertyDescriptor(HTMLSourceElement.prototype,'srcset');
if(_desc&&_desc.set){
var _origSet=_desc.set;
Object.defineProperty(HTMLSourceElement.prototype,'srcset',{get:function(){return _desc.get.call(this);},set:function(v){try{var parts=v.split(',').map(function(entry){var s=entry.trim().split(/\s+/);if(!s.length)return entry;var url=s[0];var desc=s.slice(1).join(' ');try{var u=new URL(url,location.href);var pp=proxyPrefix();if(pp&&u.origin===location.origin&&u.pathname.startsWith('/')){url=u.pathname.startsWith(pp)?u.pathname+u.search+u.hash:pp+u.pathname.slice(1)+u.search+u.hash;}}catch(e){}return desc?url+' '+desc:url;});v=parts.join(', ');}catch(e){}_origSet.call(this,v);}});
}
var _desc2=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'srcset');
if(_desc2&&_desc2.set){
var _origSet2=_desc2.set;
Object.defineProperty(HTMLImageElement.prototype,'srcset',{get:function(){return _desc2.get.call(this);},set:function(v){try{var parts=v.split(',').map(function(entry){var s=entry.trim().split(/\s+/);if(!s.length)return entry;var url=s[0];var desc=s.slice(1).join(' ');try{var u=new URL(url,location.href);var pp=proxyPrefix();if(pp&&u.origin===location.origin&&u.pathname.startsWith('/')){url=u.pathname.startsWith(pp)?u.pathname+u.search+u.hash:pp+u.pathname.slice(1)+u.search+u.hash;}}catch(e){}return desc?url+' '+desc:url;});v=parts.join(', ');}catch(e){}_origSet2.call(this,v);}});
}
})();
(function(){
// Runtime-created elements never pass through the server-side rewriter, so
// their URL attributes are fixed here. `fixAbs` is string-only on purpose:
// the URL shim above already prefixed same-origin paths and a `new URL` here
// would see that prefixed form and do nothing.
function hookProp(ctor,name){
var d=ctor&&Object.getOwnPropertyDescriptor(ctor.prototype,name);
if(!d||!d.set)return;
Object.defineProperty(ctor.prototype,name,{get:function(){return d.get.call(this);},set:function(v){d.set.call(this,fixAbs(v));}});
}
hookProp(HTMLScriptElement,'src');
hookProp(HTMLLinkElement,'href');
hookProp(HTMLIFrameElement,'src');
hookProp(HTMLSourceElement,'src');
hookProp(HTMLMediaElement,'src');
hookProp(HTMLEmbedElement,'src');
hookProp(HTMLFormElement,'action');
var _sa=Element.prototype.setAttribute;
Element.prototype.setAttribute=function(n,v){
if(typeof n==='string'){
var k=n.toLowerCase();
if(k==='src'||k==='href'||k==='poster'||k==='action'||k==='data'){v=fixAbs(v);}
}
return _sa.call(this,n,v);
};
})();
var _pushState=history.pushState;
history.pushState=function(){var r=_pushState.apply(this,arguments);notifyNav();return r;};
var _replaceState=history.replaceState;
history.replaceState=function(){var r=_replaceState.apply(this,arguments);notifyNav();return r;};
window.addEventListener('popstate',function(){notifyNav();});
function notifyNav(){
// The document URL is the upstream path (see the replaceState above), so it
// can be reported as-is; the only cleanup is Dinotty's own cache buster.
var p=location.pathname;
var pp=proxyPrefix();
// Keep the leading slash: a prefixed path that was not virtualized is
// `/preview/<seg>/slaves/x`, and the rest of it is `slaves/x`. Concatenating
// that onto `scheme://host:port` would produce `host:8089slaves/x`, which is
// not a URL at all.
if(p.indexOf(pp)===0)p='/'+p.slice(pp.length);
var real=SCHEME+'://'+HOST+':'+PORT+p+cleanSearch(location.search)+location.hash;
window.parent.postMessage({type:'proxy-navigate',url:real},'*');
}
notifyNav();
})();
</script>";

pub const INJECT_SCRIPT_EXTERNAL: &str = r"<script>(function(){
window.parent.postMessage({type:'preview-ready'},'*');
window.addEventListener('error',function(e){
window.parent.postMessage({type:'preview-error',message:e.message,source:e.filename,line:e.lineno},'*');
});
if(window.__dinotty_ext_proxy)return;
window.__dinotty_ext_proxy=true;
(function(){var _c={};['log','warn','info','debug','error'].forEach(function(l){_c[l]=console[l];console[l]=function(){_c[l].apply(console,arguments);try{var a=[];for(var i=0;i<arguments.length;i++){var v=arguments[i];if(v instanceof Error)a.push(v.message+'\n'+v.stack);else if(typeof v==='object'){try{a.push(JSON.stringify(v));}catch(e){a.push(String(v));}}else a.push(String(v));}window.parent.postMessage({type:'preview-console',level:l,args:a,ts:Date.now()},'*');}catch(e){}};});var _cl=console.clear;console.clear=function(){_cl.apply(console);try{window.parent.postMessage({type:'preview-console',level:'clear',args:[],ts:Date.now()},'*');}catch(e){}};
window.addEventListener('unhandledrejection',function(e){var m=e.reason?(e.reason.message||String(e.reason)):'Unknown promise rejection';var s=e.reason&&e.reason.stack?e.reason.stack:'';window.parent.postMessage({type:'preview-error',message:m,stack:s,unhandledRejection:true},'*');});
})();
var BASE=document.currentScript.getAttribute('data-base-url')||'';
function notifyNav(url){
window.parent.postMessage({type:'proxy-navigate',url:url},'*');
}
function realUrl(){
var h=location.href;
var m=h.match(/[?&]url=([^&]+)/);
if(m)try{return decodeURIComponent(m[1]);}catch(e){}
if(BASE)return BASE;
return h;
}
notifyNav(realUrl());
function proxyUrl(u){
try{
if(!u||u.startsWith('data:')||u.startsWith('blob:')||u.startsWith('javascript:')||u.startsWith('#'))return null;
var abs;
if(/^https?:\/\//i.test(u)){abs=u;}
else if(/^\/\//.test(u)){abs='https:'+u;}
else if(BASE){abs=new URL(u,BASE).href;}
else{return null;}
if(abs.indexOf('/api/proxy')!==-1)return null;
return'/api/proxy?url='+encodeURIComponent(abs);
}catch(e){return null;}
}
function extractReal(u){
var m=u.match(/\/api\/proxy\?url=([^&]+)/);
if(m)try{return decodeURIComponent(m[1]);}catch(e){}
return null;
}
document.addEventListener('click',function(e){
var a=e.target.closest?e.target.closest('a'):null;
if(!a||!a.href)return;
var href=a.href;
var real=extractReal(href);
if(real){
e.preventDefault();
notifyNav(real);
location.href=href;
return;
}
var t=a.getAttribute('target');
if(t==='_blank'){
var r=proxyUrl(href);
if(r){e.preventDefault();window.open(r,'_blank');}
return;
}
var r2=proxyUrl(href);
if(r2){e.preventDefault();notifyNav(href);location.href=r2;}
},true);
document.addEventListener('submit',function(e){
var f=e.target;if(!f)return;
var action=f.getAttribute('action')||f.action||'';
var realAction=extractReal(action)||action;
var target=proxyUrl(realAction);
if(!target&&action.indexOf('/api/proxy')!==-1){
target=action;
}
if(!target)return;
if((f.method||'GET').toUpperCase()==='GET'){
e.preventDefault();
var fd=new FormData(f);
var params=new URLSearchParams(fd).toString();
var baseReal=extractReal(target)||realAction;
var sep=baseReal.indexOf('?')!==-1?'&':'?';
var fullUrl=baseReal+sep+params;
var proxied='/api/proxy?url='+encodeURIComponent(fullUrl);
notifyNav(fullUrl);
location.href=proxied;
}else{
f.action=target;
}
},true);
var _open=XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open=function(m,u){this.__dn_m=m;this.__dn_u=u;var r=proxyUrl(u);return _open.apply(this,[m,r||u].concat([].slice.call(arguments,2)));};
var _send=XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send=function(){var s=performance.now(),x=this;x.addEventListener('loadend',function(){try{window.parent.postMessage({type:'preview-network',method:x.__dn_m||'GET',url:x.__dn_u,status:x.status,duration:Math.round(performance.now()-s),ts:Date.now()},'*');}catch(e){}});return _send.apply(this,arguments);};
var _fetch=window.fetch;
window.fetch=function(u,o){
var url=typeof u==='string'?u:(u instanceof Request?u.url:String(u));
var m=(o&&o.method)||((u instanceof Request)?u.method:'GET')||'GET';
var s=performance.now();
if(typeof u==='string'){var r=proxyUrl(u);if(r)u=r;}
else if(u instanceof Request){var r2=proxyUrl(u.url);if(r2)u=new Request(r2,u);}
return _fetch.call(this,u,o).then(function(resp){try{window.parent.postMessage({type:'preview-network',method:m,url:url,status:resp.status,duration:Math.round(performance.now()-s),ts:Date.now()},'*');}catch(e){}return resp;}).catch(function(err){try{window.parent.postMessage({type:'preview-network',method:m,url:url,status:0,duration:Math.round(performance.now()-s),error:true,ts:Date.now()},'*');}catch(e){}throw err;});
};
var _wopen=window.open;
window.open=function(u,n,f){
if(typeof u==='string'){var r=proxyUrl(u);if(r)u=r;}
return _wopen.call(this,u,n,f);
};
var _pushState=history.pushState;
history.pushState=function(){
var r=_pushState.apply(this,arguments);
notifyNav(realUrl());
return r;
};
var _replaceState=history.replaceState;
history.replaceState=function(){
var r=_replaceState.apply(this,arguments);
notifyNav(realUrl());
return r;
};
window.addEventListener('popstate',function(){notifyNav(realUrl());});
})();</script>";

#[cfg(test)]
mod tests {
    use super::INJECT_SCRIPT_INTERNAL;

    /// The harness-style loader creates `<script>` elements at runtime with
    /// root-absolute `src="/plugins/..."`. `<base href>` does not apply to
    /// root-absolute URLs and the server-side HTML rewriter never sees
    /// runtime-created elements, so the only thing that can fix those is a
    /// client-side hook on the script `src` setter.
    #[test]
    fn hooks_script_src_and_set_attribute() {
        assert!(
            INJECT_SCRIPT_INTERNAL.contains("hookProp(HTMLScriptElement,'src')"),
            "script src setter hook missing: runtime-injected /plugins/*.js would 404"
        );
        assert!(
            INJECT_SCRIPT_INTERNAL.contains("Element.prototype.setAttribute"),
            "setAttribute('src', ...) hook missing"
        );
    }

    /// A caller may hand the hooks an already-prefixed path (the proxy's own
    /// click handler rewrites first). Returning that form keeps the request on
    /// the proxy; dropping it (the old `return null`) makes XHR/fetch/img use
    /// the raw `/api/...` path, which hits Dinotty's own server instead of the
    /// previewed app.
    #[test]
    fn shimmed_paths_are_kept_instead_of_dropped() {
        assert!(
            INJECT_SCRIPT_INTERNAL
                .contains("if(p.pathname.indexOf(prefix)===0)return p.pathname+p.search+p.hash;"),
            "rewrite() must return the shim-prefixed path, not null"
        );
        assert!(
            INJECT_SCRIPT_INTERNAL.contains("u.pathname.startsWith(pp)?u.pathname+u.search+u.hash"),
            "img/srcset setters must accept the shim-prefixed path"
        );
    }

    /// A history-mode SPA renders its own 404 when `location.pathname` carries
    /// the proxy prefix. Before the app's module scripts run, the document URL
    /// must be rewritten to the upstream path, and the prefix must survive as
    /// a constant (the URL no longer contains it).
    #[test]
    fn document_path_is_virtualized_before_the_app_boots() {
        assert!(
            INJECT_SCRIPT_INTERNAL
                .contains("history.replaceState(history.state,'',APP_PATH+clean(location.search)+location.hash)"),
            "the injected script must strip the proxy prefix from the document URL"
        );
        assert!(
            INJECT_SCRIPT_INTERNAL.contains("window.__dinotty_virtual_path=true"),
            "the shell needs a marker to tell a virtualized preview document apart"
        );
        assert!(
            INJECT_SCRIPT_INTERNAL.contains(
                "function proxyPrefix(){\nreturn String(PREFIX||'').replace(/\\/+$/,'')+'/';"
            ),
            "the prefix must come from the injected constant, not from location"
        );
    }

    /// Navigation sync must report the upstream URL, built from the constants
    /// (the document URL is virtual and no longer names the target).
    #[test]
    fn navigate_sync_handles_scheme_and_port() {
        assert!(
            INJECT_SCRIPT_INTERNAL.contains("var real=SCHEME+'://'+HOST+':'+PORT+p"),
            "notifyNav must report the real upstream origin"
        );
        assert!(
            INJECT_SCRIPT_INTERNAL.contains("function cleanSearch(s)"),
            "the cache buster must not leak into the upstream URL"
        );
    }

    /// Same-origin URLs are the app's own origin because the document URL is
    /// virtual. They must keep the page's target instead of being dialed as
    /// Dinotty's localhost.
    #[test]
    fn same_origin_urls_keep_the_page_target() {
        assert!(
            INJECT_SCRIPT_INTERNAL
                .contains("if(p.origin===location.origin){\n// The document URL is virtual"),
            "rewrite() must map same-origin URLs to the page target"
        );
    }

    /// `fixAbs` must stay pure string manipulation. Element setters are also
    /// fed already-prefixed paths (the proxy's own click handler rewrites a
    /// link before the browser follows it), and a `new URL(...)` inside
    /// `fixAbs` would see that prefixed pathname, conclude no rewrite was
    /// needed, and silently return the 404-ing URL.
    #[test]
    fn fix_abs_does_not_depend_on_url_shim() {
        let start = INJECT_SCRIPT_INTERNAL
            .find("function fixAbs(")
            .expect("fixAbs helper missing from inject script");
        let body = &INJECT_SCRIPT_INTERNAL[start..];
        let end = body.find("\nfunction ").unwrap_or(body.len());
        let body = &body[..end];
        assert!(
            !body.contains("new URL("),
            "fixAbs must not use new URL(): an already-prefixed pathname would \
             defeat the rewrite"
        );
    }

    /// `window.URL` must stay native. Shimming it to prefix same-origin
    /// pathnames also rewrites the URLs a history-mode router builds for
    /// itself: the app then calls `history.replaceState` with
    /// `/preview/<seg>/route`, sees the proxy prefix as its own route, and
    /// renders its 404 page. Resource URLs are handled by the fetch/XHR/
    /// element hooks instead.
    #[test]
    fn window_url_is_not_shimmed() {
        assert!(
            !INJECT_SCRIPT_INTERNAL.contains("window.URL="),
            "a global URL shim corrupts history-mode routing"
        );
    }

    /// A path that still carries the proxy prefix must be reported with its
    /// leading slash: `scheme://host:port` + `slaves/x` is not a URL. The
    /// preview shell turns an unparsable URL into an `/api/proxy` route, so
    /// this bug showed up as a wrong address box.
    #[test]
    fn nav_paths_keep_their_leading_slash() {
        assert!(
            INJECT_SCRIPT_INTERNAL.contains("if(p.indexOf(pp)===0)p='/'+p.slice(pp.length);"),
            "stripping the prefix must not eat the path's leading slash"
        );
    }
}
