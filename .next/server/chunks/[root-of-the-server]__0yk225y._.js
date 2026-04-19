module.exports=[93695,(e,t,r)=>{t.exports=e.x("next/dist/shared/lib/no-fallback-error.external.js",()=>require("next/dist/shared/lib/no-fallback-error.external.js"))},18622,(e,t,r)=>{t.exports=e.x("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js",()=>require("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js"))},56704,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/work-async-storage.external.js",()=>require("next/dist/server/app-render/work-async-storage.external.js"))},32319,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/work-unit-async-storage.external.js",()=>require("next/dist/server/app-render/work-unit-async-storage.external.js"))},24725,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/after-task-async-storage.external.js",()=>require("next/dist/server/app-render/after-task-async-storage.external.js"))},70406,(e,t,r)=>{t.exports=e.x("next/dist/compiled/@opentelemetry/api",()=>require("next/dist/compiled/@opentelemetry/api"))},91837,e=>e.a(async(t,r)=>{try{var a=e.i(17835),n=e.i(22648),s=t([n]);[n]=s.then?(await s)():s;let o=`
CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY,
  invite_code TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS babies (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  birth_date INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  baby_id TEXT NOT NULL REFERENCES babies(id),
  type TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  details TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS active_timers (
  id TEXT PRIMARY KEY,
  baby_id TEXT NOT NULL REFERENCES babies(id),
  type TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  current_side TEXT,
  side_switches TEXT,
  started_by TEXT
);

CREATE TABLE IF NOT EXISTS measurements (
  id TEXT PRIMARY KEY,
  baby_id TEXT NOT NULL REFERENCES babies(id),
  measured_at INTEGER NOT NULL,
  weight_g INTEGER,
  length_mm INTEGER,
  head_mm INTEGER,
  note TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  label TEXT
);

CREATE TABLE IF NOT EXISTS notification_log (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  kind TEXT NOT NULL,
  sent_at INTEGER NOT NULL
);
`;async function i(e){let{searchParams:t}=new URL(e.url);if(t.get("key")!==process.env.MIGRATION_KEY)return a.NextResponse.json({error:"Unauthorized"},{status:401});try{let e=(0,n.createClient)({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN});return await e.execute(o),e.close(),a.NextResponse.json({success:!0,message:"Migrations completed"})}catch(e){return console.error("Migration error:",e),a.NextResponse.json({error:"Migration failed",details:String(e)},{status:500})}}e.s(["GET",0,i,"runtime",0,"nodejs"]),r()}catch(e){r(e)}},!1),25425,e=>e.a(async(t,r)=>{try{var a=e.i(77549),n=e.i(9949),s=e.i(15457),i=e.i(12679),o=e.i(58583),d=e.i(55429),l=e.i(513),u=e.i(73130),E=e.i(82692),p=e.i(50329),T=e.i(86748),c=e.i(63897),R=e.i(97251),N=e.i(69724),h=e.i(85667),x=e.i(93695);e.i(95190);var v=e.i(53968),m=e.i(91837),g=t([m]);[m]=g.then?(await g)():g;let A=new a.AppRouteRouteModule({definition:{kind:n.RouteKind.APP_ROUTE,page:"/api/admin/migrate/route",pathname:"/api/admin/migrate",filename:"route",bundlePath:""},distDir:".next",relativeProjectDir:"",resolvedPagePath:"[project]/projects/mcphee/src/app/api/admin/migrate/route.ts",nextConfigOutput:"",userland:m,...{}}),{workAsyncStorage:O,workUnitAsyncStorage:_,serverHooks:I}=A;async function L(e,t,r){r.requestMeta&&(0,i.setRequestMeta)(e,r.requestMeta),A.isDev&&(0,i.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let a="/api/admin/migrate/route";a=a.replace(/\/index$/,"")||"/";let s=await A.prepare(e,t,{srcPage:a,multiZoneDraftMode:!1});if(!s)return t.statusCode=400,t.end("Bad Request"),null==r.waitUntil||r.waitUntil.call(r,Promise.resolve()),null;let{buildId:m,params:g,nextConfig:L,parsedUrl:O,isDraftMode:_,prerenderManifest:I,routerServerContext:C,isOnDemandRevalidate:w,revalidateOnlyGenerated:y,resolvedPathname:b,clientReferenceManifest:f,serverActionsManifest:S}=s,U=(0,l.normalizeAppPath)(a),X=!!(I.dynamicRoutes[U]||I.routes[b]),P=async()=>((null==C?void 0:C.render404)?await C.render404(e,t,O,!1):t.end("This page could not be found"),null);if(X&&!_){let e=!!I.routes[b],t=I.dynamicRoutes[U];if(t&&!1===t.fallback&&!e){if(L.adapterPath)return await P();throw new x.NoFallbackError}}let M=null;!X||A.isDev||_||(M=b,M="/index"===M?"/":M);let k=!0===A.isDev||!X,q=X&&!k;S&&f&&(0,d.setManifestsSingleton)({page:a,clientReferenceManifest:f,serverActionsManifest:S});let j=e.method||"GET",F=(0,o.getTracer)(),G=F.getActiveScopeSpan(),H=!!(null==C?void 0:C.isWrappedByNextServer),K=!!(0,i.getRequestMeta)(e,"minimalMode"),Y=(0,i.getRequestMeta)(e,"incrementalCache")||await A.getIncrementalCache(e,L,I,K);null==Y||Y.resetRequestCache(),globalThis.__incrementalCache=Y;let B={params:g,previewProps:I.preview,renderOpts:{experimental:{authInterrupts:!!L.experimental.authInterrupts},cacheComponents:!!L.cacheComponents,supportsDynamicResponse:k,incrementalCache:Y,cacheLifeProfiles:L.cacheLife,waitUntil:r.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,r,a,n)=>A.onRequestError(e,t,a,n,C)},sharedContext:{buildId:m}},D=new u.NodeNextRequest(e),$=new u.NodeNextResponse(t),V=E.NextRequestAdapter.fromNodeNextRequest(D,(0,E.signalFromNodeResponse)(t));try{let s,i=async e=>A.handle(V,B).finally(()=>{if(!e)return;e.setAttributes({"http.status_code":t.statusCode,"next.rsc":!1});let r=F.getRootSpanAttributes();if(!r)return;if(r.get("next.span_type")!==p.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${r.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let n=r.get("next.route");if(n){let t=`${j} ${n}`;e.setAttributes({"next.route":n,"http.route":n,"next.span_name":t}),e.updateName(t),s&&s!==e&&(s.setAttribute("http.route",n),s.updateName(t))}else e.updateName(`${j} ${a}`)}),d=async s=>{var o,d;let l=async({previousCacheEntry:n})=>{try{if(!K&&w&&y&&!n)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let a=await i(s);e.fetchMetrics=B.renderOpts.fetchMetrics;let o=B.renderOpts.pendingWaitUntil;o&&r.waitUntil&&(r.waitUntil(o),o=void 0);let d=B.renderOpts.collectedTags;if(!X)return await (0,c.sendResponse)(D,$,a,B.renderOpts.pendingWaitUntil),null;{let e=await a.blob(),t=(0,R.toNodeOutgoingHttpHeaders)(a.headers);d&&(t[h.NEXT_CACHE_TAGS_HEADER]=d),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let r=void 0!==B.renderOpts.collectedRevalidate&&!(B.renderOpts.collectedRevalidate>=h.INFINITE_CACHE)&&B.renderOpts.collectedRevalidate,n=void 0===B.renderOpts.collectedExpire||B.renderOpts.collectedExpire>=h.INFINITE_CACHE?void 0:B.renderOpts.collectedExpire;return{value:{kind:v.CachedRouteKind.APP_ROUTE,status:a.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:r,expire:n}}}}catch(t){throw(null==n?void 0:n.isStale)&&await A.onRequestError(e,t,{routerKind:"App Router",routePath:a,routeType:"route",revalidateReason:(0,T.getRevalidateReason)({isStaticGeneration:q,isOnDemandRevalidate:w})},!1,C),t}},u=await A.handleResponse({req:e,nextConfig:L,cacheKey:M,routeKind:n.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:I,isRoutePPREnabled:!1,isOnDemandRevalidate:w,revalidateOnlyGenerated:y,responseGenerator:l,waitUntil:r.waitUntil,isMinimalMode:K});if(!X)return null;if((null==u||null==(o=u.value)?void 0:o.kind)!==v.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==u||null==(d=u.value)?void 0:d.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});K||t.setHeader("x-nextjs-cache",w?"REVALIDATED":u.isMiss?"MISS":u.isStale?"STALE":"HIT"),_&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let E=(0,R.fromNodeOutgoingHttpHeaders)(u.value.headers);return K&&X||E.delete(h.NEXT_CACHE_TAGS_HEADER),!u.cacheControl||t.getHeader("Cache-Control")||E.get("Cache-Control")||E.set("Cache-Control",(0,N.getCacheControlHeader)(u.cacheControl)),await (0,c.sendResponse)(D,$,new Response(u.value.body,{headers:E,status:u.value.status||200})),null};H&&G?await d(G):(s=F.getActiveScopeSpan(),await F.withPropagatedContext(e.headers,()=>F.trace(p.BaseServerSpan.handleRequest,{spanName:`${j} ${a}`,kind:o.SpanKind.SERVER,attributes:{"http.method":j,"http.target":e.url}},d),void 0,!H))}catch(t){if(t instanceof x.NoFallbackError||await A.onRequestError(e,t,{routerKind:"App Router",routePath:U,routeType:"route",revalidateReason:(0,T.getRevalidateReason)({isStaticGeneration:q,isOnDemandRevalidate:w})},!1,C),X)throw t;return await (0,c.sendResponse)(D,$,new Response(null,{status:500})),null}}e.s(["handler",0,L,"patchFetch",0,function(){return(0,s.patchFetch)({workAsyncStorage:O,workUnitAsyncStorage:_})},"routeModule",0,A,"serverHooks",0,I,"workAsyncStorage",0,O,"workUnitAsyncStorage",0,_]),r()}catch(e){r(e)}},!1)];

//# sourceMappingURL=%5Broot-of-the-server%5D__0yk225y._.js.map