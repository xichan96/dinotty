pub const INJECT_SCRIPT_INTERNAL: &str = r"<script>(function(){
window.parent.postMessage({type:'preview-ready'},'*');
window.parent.postMessage({type:'preview-console',level:'info',args:['[dinotty] inject script loaded'],ts:Date.now()});
window.addEventListener('error',function(e){
window.parent.postMessage({type:'preview-error',message:e.message,source:e.filename,line:e.lineno},'*');
});
var defined=window.__dinotty_proxy_port;
if(!defined){
var PORT=document.currentScript.getAttribute('data-port');
var HOST=document.currentScript.getAttribute('data-host');
window.__dinotty_proxy_port=PORT;
window.__dinotty_proxy_host=HOST;
(function(){var _c={};['log','warn','info','debug','error'].forEach(function(l){_c[l]=console[l];console[l]=function(){_c[l].apply(console,arguments);try{var a=[];for(var i=0;i<arguments.length;i++){var v=arguments[i];if(v instanceof Error)a.push(v.message+'\n'+v.stack);else if(typeof v==='object'){try{a.push(JSON.stringify(v));}catch(e){a.push(String(v));}}else a.push(String(v));}window.parent.postMessage({type:'preview-console',level:l,args:a,ts:Date.now()},'*');}catch(e){}};});var _cl=console.clear;console.clear=function(){_cl.apply(console);try{window.parent.postMessage({type:'preview-console',level:'clear',args:[],ts:Date.now()},'*');}catch(e){}};
window.addEventListener('unhandledrejection',function(e){var m=e.reason?(e.reason.message||String(e.reason)):'Unknown promise rejection';var s=e.reason&&e.reason.stack?e.reason.stack:'';window.parent.postMessage({type:'preview-error',message:m,stack:s,unhandledRejection:true},'*');});
})();
function proxyPrefix(){
var m=(location.pathname||'').match(/^(\/preview\/(?:[^\/]+\/)?\d+\/)/);
return m?m[1]:null;
}
function applyProxyPrefix(u){
var pp=proxyPrefix();
if(!pp)return u.href;
var base=u.origin;
return pp+u.pathname.slice(1)+u.search+u.hash;
}
function fixAbs(v){
if(typeof v!=='string')return v;
var pp=proxyPrefix();
if(!pp)return v;
if(v.charAt(0)==='/'&&v.charAt(1)!=='/'&&v.indexOf(pp)!==0)return pp+v.slice(1);
if(v.indexOf(location.origin)===0){
var r=v.slice(location.origin.length);
if(r.charAt(0)==='/'&&r.indexOf(pp)!==0)return pp+r.slice(1);}
return v;
}
function rewrite(u){
try{var p=new URL(u,location.href);
var h=p.hostname;
var lp=location.hostname+':'+location.port;
var pp=proxyPrefix();
if(pp&&(h===HOST||h==='127.0.0.1'||h==='localhost'||h==='0.0.0.0'||lp.endsWith(':'+h)||h===lp.split(':')[0])){
if(p.pathname.startsWith('/preview/'))return null;
var pt=(p.port&&p.port!==location.port)?p.port:PORT;
var prefix=(HOST==='127.0.0.1')?'/preview/'+pt:'/preview/'+HOST+'/'+pt;
return prefix+p.pathname+p.search+p.hash;}
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
var pt=(parsed.port&&parsed.port!==location.port)?parsed.port:PORT;
var prefix=(HOST==='127.0.0.1')?'/preview/'+pt:'/preview/'+HOST+'/'+pt;
var wsProto=location.protocol==='https:'?'wss:':'ws:';
u=wsProto+'//'+location.host+prefix+parsed.pathname+parsed.search;
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
var _RealURL=window.URL;
function _URLShim(url,base){
var u=url instanceof _RealURL?new _RealURL(url.href,base):new _RealURL(url,base);
var pp=proxyPrefix();
if(pp&&u.origin===location.origin&&u.pathname.startsWith('/')&&!u.pathname.startsWith(pp)){
var fixed=new _RealURL(pp+u.pathname.slice(1)+u.search+u.hash,u.origin);
['protocol','username','password','host','hostname','port','pathname','search','hash'].forEach(function(k){try{u[k]=fixed[k];}catch(e){}});
}
return u;
}
_URLShim.createObjectURL=_RealURL.createObjectURL.bind(_RealURL);
_URLShim.revokeObjectURL=_RealURL.revokeObjectURL.bind(_RealURL);
_URLShim.prototype=_RealURL.prototype;
_URLShim.toString=function(){return _RealURL.toString();};
window.URL=_URLShim;
})();
(function(){
var _RealImage=window.Image;
function _ImageShim(){return _wrapImg(new _RealImage());}
function _wrapImg(img){
var _desc=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
if(!_desc)return img;
Object.defineProperty(img,'src',{get:function(){return _desc.get.call(img);},set:function(v){try{var u=new URL(v,location.href);var pp=proxyPrefix();if(pp&&u.origin===location.origin&&u.pathname.startsWith('/')&&!u.pathname.startsWith(pp)){v=pp+u.pathname.slice(1)+u.search+u.hash;}}catch(e){}_desc.set.call(img,v);}});
return img;
}
_ImageShim.prototype=_RealImage.prototype;
_ImageShim.prototype.constructor=_ImageShim;
Object.defineProperty(_ImageShim,Symbol.hasInstance,{value:function(o){return o instanceof _RealImage;}});
window.Image=_ImageShim;
var _desc=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
if(_desc&&_desc.set){
var _origSet=_desc.set;
Object.defineProperty(HTMLImageElement.prototype,'src',{get:function(){return _desc.get.call(this);},set:function(v){try{var u=new URL(v,location.href);var pp=proxyPrefix();if(pp&&u.origin===location.origin&&u.pathname.startsWith('/')&&!u.pathname.startsWith(pp)){v=pp+u.pathname.slice(1)+u.search+u.hash;}}catch(e){}_origSet.call(this,v);}});
}
})();
(function(){
var _desc=Object.getOwnPropertyDescriptor(HTMLSourceElement.prototype,'srcset');
if(_desc&&_desc.set){
var _origSet=_desc.set;
Object.defineProperty(HTMLSourceElement.prototype,'srcset',{get:function(){return _desc.get.call(this);},set:function(v){try{var parts=v.split(',').map(function(entry){var s=entry.trim().split(/\s+/);if(!s.length)return entry;var url=s[0];var desc=s.slice(1).join(' ');try{var u=new URL(url,location.href);var pp=proxyPrefix();if(pp&&u.origin===location.origin&&u.pathname.startsWith('/')&&!u.pathname.startsWith(pp)){url=pp+u.pathname.slice(1)+u.search+u.hash;}}catch(e){}return desc?url+' '+desc:url;});v=parts.join(', ');}catch(e){}_origSet.call(this,v);}});
}
var _desc2=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'srcset');
if(_desc2&&_desc2.set){
var _origSet2=_desc2.set;
Object.defineProperty(HTMLImageElement.prototype,'srcset',{get:function(){return _desc2.get.call(this);},set:function(v){try{var parts=v.split(',').map(function(entry){var s=entry.trim().split(/\s+/);if(!s.length)return entry;var url=s[0];var desc=s.slice(1).join(' ');try{var u=new URL(url,location.href);var pp=proxyPrefix();if(pp&&u.origin===location.origin&&u.pathname.startsWith('/')&&!u.pathname.startsWith(pp)){url=pp+u.pathname.slice(1)+u.search+u.hash;}}catch(e){}return desc?url+' '+desc:url;});v=parts.join(', ');}catch(e){}_origSet2.call(this,v);}});
}
})();
(function(){
var _d=Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype,'src');
if(_d&&_d.set){
var _s=_d.set;
Object.defineProperty(HTMLScriptElement.prototype,'src',{get:function(){return _d.get.call(this);},set:function(v){_s.call(this,fixAbs(v));}});
}
var _sa=Element.prototype.setAttribute;
Element.prototype.setAttribute=function(n,v){
if(typeof n==='string'&&n.toLowerCase()==='src'&&this instanceof HTMLScriptElement){v=fixAbs(v);}
return _sa.call(this,n,v);
};
})();
var _pushState=history.pushState;
history.pushState=function(){var r=_pushState.apply(this,arguments);notifyNav();return r;};
var _replaceState=history.replaceState;
history.replaceState=function(){var r=_replaceState.apply(this,arguments);notifyNav();return r;};
window.addEventListener('popstate',function(){notifyNav();});
function notifyNav(){
var m=location.pathname.match(/^\/preview\/(?:([^\/]+?)\/)?(\d+)(\/.*)?$/);
if(!m)return;
var h=m[1]||'127.0.0.1',pt=m[2],path=m[3]||'/';
var real='http://'+h+':'+pt+path+location.search+location.hash;
window.parent.postMessage({type:'proxy-navigate',url:real},'*');
}
notifyNav();
}
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
            INJECT_SCRIPT_INTERNAL.contains("HTMLScriptElement.prototype,'src'"),
            "script src setter hook missing: runtime-injected /plugins/*.js would 404"
        );
        assert!(
            INJECT_SCRIPT_INTERNAL.contains("Element.prototype.setAttribute"),
            "setAttribute('src', ...) hook missing"
        );
    }

    /// `fixAbs` must stay pure string manipulation. The script installs a
    /// `window.URL` shim earlier that already applies the proxy prefix, so a
    /// `new URL(...)` inside `fixAbs` would see an already-prefixed pathname,
    /// conclude no rewrite was needed, and silently return the 404-ing URL.
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
            "fixAbs must not use new URL(): the window.URL shim already prefixes \
             the pathname, which would defeat the rewrite"
        );
    }
}
