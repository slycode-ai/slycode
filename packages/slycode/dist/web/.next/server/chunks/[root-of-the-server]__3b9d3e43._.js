module.exports=[18622,(e,t,r)=>{t.exports=e.x("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js",()=>require("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js"))},56704,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/work-async-storage.external.js",()=>require("next/dist/server/app-render/work-async-storage.external.js"))},32319,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/work-unit-async-storage.external.js",()=>require("next/dist/server/app-render/work-unit-async-storage.external.js"))},24725,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/after-task-async-storage.external.js",()=>require("next/dist/server/app-render/after-task-async-storage.external.js"))},70406,(e,t,r)=>{t.exports=e.x("next/dist/compiled/@opentelemetry/api",()=>require("next/dist/compiled/@opentelemetry/api"))},93695,(e,t,r)=>{t.exports=e.x("next/dist/shared/lib/no-fallback-error.external.js",()=>require("next/dist/shared/lib/no-fallback-error.external.js"))},14747,(e,t,r)=>{t.exports=e.x("path",()=>require("path"))},22734,(e,t,r)=>{t.exports=e.x("fs",()=>require("fs"))},7367,e=>{"use strict";var t=e.i(14747),r=e.i(22734);function a(){if(process.env.SLYCODE_HOME)return process.env.SLYCODE_HOME;let e=process.cwd();return(console.warn("[paths] SLYCODE_HOME not set in production — falling back to cwd:",e),e.endsWith("/web")||e.endsWith("\\web"))?t.default.dirname(e):e}function n(){let e=a(),n=t.default.join(e,"node_modules","@slycode","slycode","dist");return r.default.existsSync(n)?n:e}function s(){return process.env.BRIDGE_URL?process.env.BRIDGE_URL:"http://127.0.0.1:3004"}e.s(["getBridgeUrl",()=>s,"getPackageDir",()=>n,"getSlycodeRoot",()=>a])},36688,e=>{"use strict";var t=e.i(47909),r=e.i(74017),a=e.i(96250),n=e.i(59756),s=e.i(61916),i=e.i(74677),o=e.i(69741),d=e.i(16795),l=e.i(87718),c=e.i(95169),u=e.i(47587),p=e.i(66012),h=e.i(70101),m=e.i(74838),f=e.i(10372),v=e.i(93695);e.i(52474);var g=e.i(220),x=e.i(89171),y=e.i(22734),R=e.i(14747),C=e.i(7367);async function w(e){try{var t,r,a,n,s,i,o,d,l,c,u,p,h,m,f,v,g,w;let E,$,b,{mode:k,provider:P,assetType:A,assetName:T,description:S,changes:N}=await e.json();if(!k||!P||!A)return x.NextResponse.json({error:"mode, provider, and assetType are required"},{status:400});if("create"===k&&(!T||!S))return x.NextResponse.json({error:"assetName and description are required for create mode"},{status:400});if("modify"===k&&!T)return x.NextResponse.json({error:"assetName is required for modify mode"},{status:400});let M=(0,C.getSlycodeRoot)();if("mcp"===A)$=R.default.join(M,`store/mcp/${T}.json`);else{let e="skill"===A?"skills":"agents",t="skill"===A?`store/${e}/${T}/SKILL.md`:`store/${e}/${T}.md`;$=R.default.join(M,t)}let O=R.default.join(M,"documentation","reference","ai_cli_providers.md");if("modify"===k&&!y.default.existsSync($)){if("mcp"===A)return x.NextResponse.json({error:`Could not find MCP config '${T}' at ${$}`},{status:404});if("skill"!==A)return x.NextResponse.json({error:`Could not find asset '${T}' in store at ${$}`},{status:404})}return b="mcp"===A?"create"===k?(t=T,r=S,a=$,`Create an MCP (Model Context Protocol) server configuration called "${t}".

**Output file:** \`${a}\`

## What this MCP server should do
${r}

## Research steps

1. Research the MCP server package described above — find the correct npm package name, command, and required arguments
2. Check if there are any required environment variables or setup steps
3. Determine whether this is a stdio MCP (runs locally via command) or HTTP MCP (connects to a URL)

## Store JSON format

There are two transport types. Use the one that matches the MCP server:

### Stdio MCP (runs a local process)
\`\`\`json
{
  "name": "${t}",
  "command": "<executable, e.g. npx, node, python>",
  "args": ["<arguments to launch the MCP server>"],
  "env": {
    "API_KEY": "\${API_KEY}"
  },
  "description": "<concise one-line description>",
  "version": "1.0.0",
  "updated": "<today's date, YYYY-MM-DD>"
}
\`\`\`

### HTTP MCP (connects to a remote URL)
\`\`\`json
{
  "name": "${t}",
  "url": "https://<mcp-server-url>",
  "headers": {
    "Authorization": "Bearer \${API_KEY}"
  },
  "description": "<concise one-line description>",
  "version": "1.0.0",
  "updated": "<today's date, YYYY-MM-DD>"
}
\`\`\`

## Key points
- \`name\` must be \`${t}\`
- **Stdio**: \`command\` is the executable (usually \`npx\`), \`args\` is an array, \`env\` holds environment variables with \`\${PLACEHOLDER}\` values
- **HTTP**: \`url\` is the MCP server endpoint, \`headers\` is optional (for auth tokens etc.)
- Do NOT include both \`command\` and \`url\` — pick one transport type
- \`description\`, \`version\`, and \`updated\` are required metadata fields
- The file must be valid JSON

Write the config to \`${a}\`.`):(n=T,s=N||"",i=$,`Modify the MCP server configuration "${n}".

**File to modify:** \`${i}\`

Read the file, then apply these changes:

${s||"Review and improve this MCP configuration. Verify the package exists, update to latest version, and ensure all fields are correct."}

## Rules
- Keep the JSON structure intact
- Update \`version\` (patch increment, e.g. 1.0.0 → 1.0.1)
- Update \`updated\` to today's date
- Keep \`name\` as \`${n}\`
- The file must be valid JSON

Write the updated file back to \`${i}\`.`):"create"===k?(o=P,d=A,l=T,c=S,u=$,p=O,E={claude:"Claude Code",agents:"Agents (Universal)",codex:"Codex CLI",gemini:"Gemini CLI"},`Create a new ${E[o]} ${d} called "${l}".

**Format reference:** \`${p}\`
**Output file:** \`${u}\`

## What it should do
${c}

## ${d.charAt(0).toUpperCase()+d.slice(1)} format
${({skill:"Skills are SKILL.md files that give the AI specialized knowledge or workflows. They can be invoked via slash commands. They describe when/how to use the skill and can include a references/ subdirectory for supporting files. The skill directory structure is: skillname/SKILL.md and optionally skillname/references/*.md.",agent:"Agents are custom agent definitions that configure specialized behavior, purpose, capabilities, and tool usage."})[d]||""}

Read the format reference for ${E[o]}-specific conventions, then create the ${d}.

## Required frontmatter

\`\`\`yaml
---
name: ${l}
version: 1.0.0
updated: <today's date, YYYY-MM-DD>
description: "<concise one-line summary>"
---
\`\`\`

All four fields are mandatory. The description should summarize the ${d}'s purpose in one line.
${"agents"===o?`
## Provider-Neutral Language

Since this asset targets the universal .agents/ directory (used by both Codex CLI and Gemini CLI), you MUST write all text in provider-neutral language:
- Do NOT mention specific tools like "Claude Code", "Codex CLI", or "Gemini CLI"
- Use generic terms like "the AI assistant" or "the agent" instead
- The content should work identically across any AI coding tool that reads .agents/
`:""}
Write the complete file to \`${u}\`.`):(h=P,m=A,f=T,v=N||"",g=$,w=O,`Modify the ${({claude:"Claude Code",agents:"Agents (Universal)",codex:"Codex CLI",gemini:"Gemini CLI"})[h]} ${m} "${f}".

**File to modify:** \`${g}\`
**Format reference:** \`${w}\`

Read the file, then apply these changes:

${v||"Review and improve this asset. Fix any issues, improve clarity, and ensure it follows best practices."}

## Frontmatter rules
- Bump the \`version\` (patch increment, e.g. 1.0.0 → 1.0.1)
- Update \`updated\` to today's date
- Keep all other frontmatter fields intact (\`name\`, \`description\`)
- If any required field is missing, add it

Write the updated file back to \`${g}\`.`),x.NextResponse.json({prompt:b,outputPath:$})}catch(e){return console.error("Asset assistant failed:",e),x.NextResponse.json({error:"Failed to generate assistant prompt",details:String(e)},{status:500})}}e.s(["POST",()=>w],82398);var E=e.i(82398);let $=new t.AppRouteRouteModule({definition:{kind:r.RouteKind.APP_ROUTE,page:"/api/cli-assets/assistant/route",pathname:"/api/cli-assets/assistant",filename:"route",bundlePath:""},distDir:".next",relativeProjectDir:"",resolvedPagePath:"[project]/src/app/api/cli-assets/assistant/route.ts",nextConfigOutput:"standalone",userland:E}),{workAsyncStorage:b,workUnitAsyncStorage:k,serverHooks:P}=$;function A(){return(0,a.patchFetch)({workAsyncStorage:b,workUnitAsyncStorage:k})}async function T(e,t,a){$.isDev&&(0,n.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let x="/api/cli-assets/assistant/route";x=x.replace(/\/index$/,"")||"/";let y=await $.prepare(e,t,{srcPage:x,multiZoneDraftMode:!1});if(!y)return t.statusCode=400,t.end("Bad Request"),null==a.waitUntil||a.waitUntil.call(a,Promise.resolve()),null;let{buildId:R,params:C,nextConfig:w,parsedUrl:E,isDraftMode:b,prerenderManifest:k,routerServerContext:P,isOnDemandRevalidate:A,revalidateOnlyGenerated:T,resolvedPathname:S,clientReferenceManifest:N,serverActionsManifest:M}=y,O=(0,o.normalizeAppPath)(x),I=!!(k.dynamicRoutes[O]||k.routes[S]),j=async()=>((null==P?void 0:P.render404)?await P.render404(e,t,E,!1):t.end("This page could not be found"),null);if(I&&!b){let e=!!k.routes[S],t=k.dynamicRoutes[O];if(t&&!1===t.fallback&&!e){if(w.experimental.adapterPath)return await j();throw new v.NoFallbackError}}let _=null;!I||$.isDev||b||(_="/index"===(_=S)?"/":_);let q=!0===$.isDev||!I,U=I&&!q;M&&N&&(0,i.setManifestsSingleton)({page:x,clientReferenceManifest:N,serverActionsManifest:M});let D=e.method||"GET",L=(0,s.getTracer)(),H=L.getActiveScopeSpan(),K={params:C,prerenderManifest:k,renderOpts:{experimental:{authInterrupts:!!w.experimental.authInterrupts},cacheComponents:!!w.cacheComponents,supportsDynamicResponse:q,incrementalCache:(0,n.getRequestMeta)(e,"incrementalCache"),cacheLifeProfiles:w.cacheLife,waitUntil:a.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,r,a,n)=>$.onRequestError(e,t,a,n,P)},sharedContext:{buildId:R}},Y=new d.NodeNextRequest(e),F=new d.NodeNextResponse(t),B=l.NextRequestAdapter.fromNodeNextRequest(Y,(0,l.signalFromNodeResponse)(t));try{let i=async e=>$.handle(B,K).finally(()=>{if(!e)return;e.setAttributes({"http.status_code":t.statusCode,"next.rsc":!1});let r=L.getRootSpanAttributes();if(!r)return;if(r.get("next.span_type")!==c.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${r.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let a=r.get("next.route");if(a){let t=`${D} ${a}`;e.setAttributes({"next.route":a,"http.route":a,"next.span_name":t}),e.updateName(t)}else e.updateName(`${D} ${x}`)}),o=!!(0,n.getRequestMeta)(e,"minimalMode"),d=async n=>{var s,d;let l=async({previousCacheEntry:r})=>{try{if(!o&&A&&T&&!r)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let s=await i(n);e.fetchMetrics=K.renderOpts.fetchMetrics;let d=K.renderOpts.pendingWaitUntil;d&&a.waitUntil&&(a.waitUntil(d),d=void 0);let l=K.renderOpts.collectedTags;if(!I)return await (0,p.sendResponse)(Y,F,s,K.renderOpts.pendingWaitUntil),null;{let e=await s.blob(),t=(0,h.toNodeOutgoingHttpHeaders)(s.headers);l&&(t[f.NEXT_CACHE_TAGS_HEADER]=l),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let r=void 0!==K.renderOpts.collectedRevalidate&&!(K.renderOpts.collectedRevalidate>=f.INFINITE_CACHE)&&K.renderOpts.collectedRevalidate,a=void 0===K.renderOpts.collectedExpire||K.renderOpts.collectedExpire>=f.INFINITE_CACHE?void 0:K.renderOpts.collectedExpire;return{value:{kind:g.CachedRouteKind.APP_ROUTE,status:s.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:r,expire:a}}}}catch(t){throw(null==r?void 0:r.isStale)&&await $.onRequestError(e,t,{routerKind:"App Router",routePath:x,routeType:"route",revalidateReason:(0,u.getRevalidateReason)({isStaticGeneration:U,isOnDemandRevalidate:A})},!1,P),t}},c=await $.handleResponse({req:e,nextConfig:w,cacheKey:_,routeKind:r.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:k,isRoutePPREnabled:!1,isOnDemandRevalidate:A,revalidateOnlyGenerated:T,responseGenerator:l,waitUntil:a.waitUntil,isMinimalMode:o});if(!I)return null;if((null==c||null==(s=c.value)?void 0:s.kind)!==g.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==c||null==(d=c.value)?void 0:d.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});o||t.setHeader("x-nextjs-cache",A?"REVALIDATED":c.isMiss?"MISS":c.isStale?"STALE":"HIT"),b&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let v=(0,h.fromNodeOutgoingHttpHeaders)(c.value.headers);return o&&I||v.delete(f.NEXT_CACHE_TAGS_HEADER),!c.cacheControl||t.getHeader("Cache-Control")||v.get("Cache-Control")||v.set("Cache-Control",(0,m.getCacheControlHeader)(c.cacheControl)),await (0,p.sendResponse)(Y,F,new Response(c.value.body,{headers:v,status:c.value.status||200})),null};H?await d(H):await L.withPropagatedContext(e.headers,()=>L.trace(c.BaseServerSpan.handleRequest,{spanName:`${D} ${x}`,kind:s.SpanKind.SERVER,attributes:{"http.method":D,"http.target":e.url}},d))}catch(t){if(t instanceof v.NoFallbackError||await $.onRequestError(e,t,{routerKind:"App Router",routePath:O,routeType:"route",revalidateReason:(0,u.getRevalidateReason)({isStaticGeneration:U,isOnDemandRevalidate:A})},!1,P),I)throw t;return await (0,p.sendResponse)(Y,F,new Response(null,{status:500})),null}}e.s(["handler",()=>T,"patchFetch",()=>A,"routeModule",()=>$,"serverHooks",()=>P,"workAsyncStorage",()=>b,"workUnitAsyncStorage",()=>k],36688)}];

//# sourceMappingURL=%5Broot-of-the-server%5D__3b9d3e43._.js.map