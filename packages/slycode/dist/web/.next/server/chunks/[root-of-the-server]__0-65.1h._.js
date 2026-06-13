module.exports=[18622,(e,t,r)=>{t.exports=e.x("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js",()=>require("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js"))},56704,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/work-async-storage.external.js",()=>require("next/dist/server/app-render/work-async-storage.external.js"))},32319,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/work-unit-async-storage.external.js",()=>require("next/dist/server/app-render/work-unit-async-storage.external.js"))},24725,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/after-task-async-storage.external.js",()=>require("next/dist/server/app-render/after-task-async-storage.external.js"))},70406,(e,t,r)=>{t.exports=e.x("next/dist/compiled/@opentelemetry/api",()=>require("next/dist/compiled/@opentelemetry/api"))},93695,(e,t,r)=>{t.exports=e.x("next/dist/shared/lib/no-fallback-error.external.js",()=>require("next/dist/shared/lib/no-fallback-error.external.js"))},14747,(e,t,r)=>{t.exports=e.x("path",()=>require("path"))},46786,(e,t,r)=>{t.exports=e.x("os",()=>require("os"))},22734,(e,t,r)=>{t.exports=e.x("fs",()=>require("fs"))},7367,e=>{"use strict";var t=e.i(14747),r=e.i(22734),a=e.i(46786);function s(){if(process.env.SLYCODE_HOME)return process.env.SLYCODE_HOME;let e=process.cwd();return(console.warn("[paths] SLYCODE_HOME not set in production — falling back to cwd:",e),e.endsWith("/web")||e.endsWith("\\web"))?t.default.dirname(e):e}e.s(["expandTilde",0,function(e){return(e=e.replace(/^[\u02dc\uff5e]/,"~")).startsWith("~/")||"~"===e?e.replace(/^~/,a.default.homedir()):e},"getBridgeUrl",0,function(){return process.env.BRIDGE_URL?process.env.BRIDGE_URL:"http://127.0.0.1:3004"},"getPackageDir",0,function(){let e=s(),a=t.default.join(e,"node_modules","@slycode","slycode","dist");return r.default.existsSync(a)?a:e},"getSlycodeRoot",0,s])},36688,e=>{"use strict";var t=e.i(47909),r=e.i(74017),a=e.i(96250),s=e.i(59756),n=e.i(61916),i=e.i(74677),o=e.i(69741),d=e.i(16795),l=e.i(87718),u=e.i(95169),c=e.i(47587),p=e.i(66012),h=e.i(70101),m=e.i(74838),f=e.i(10372),v=e.i(93695);e.i(20232);var g=e.i(220),x=e.i(89171),R=e.i(22734),y=e.i(14747),C=e.i(7367);async function w(e){try{var t,r,a,s,n,i,o,d,l,u,c,p,h,m,f,v,g,w;let E,$,b,{mode:P,provider:k,assetType:A,assetName:T,description:S,changes:M}=await e.json();if(!P||!k||!A)return x.NextResponse.json({error:"mode, provider, and assetType are required"},{status:400});if("create"===P&&(!T||!S))return x.NextResponse.json({error:"assetName and description are required for create mode"},{status:400});if("modify"===P&&!T)return x.NextResponse.json({error:"assetName is required for modify mode"},{status:400});let N=(0,C.getSlycodeRoot)();if("mcp"===A)$=y.default.join(N,`store/mcp/${T}.json`);else{let e="skill"===A?"skills":"agents",t="skill"===A?`store/${e}/${T}/SKILL.md`:`store/${e}/${T}.md`;$=y.default.join(N,t)}let O=y.default.join(N,"documentation","reference","ai_cli_providers.md");if("modify"===P&&!R.default.existsSync($)){if("mcp"===A)return x.NextResponse.json({error:`Could not find MCP config '${T}' at ${$}`},{status:404});if("skill"!==A)return x.NextResponse.json({error:`Could not find asset '${T}' in store at ${$}`},{status:404})}return b="mcp"===A?"create"===P?(t=T,r=S,a=$,`Create an MCP (Model Context Protocol) server configuration called "${t}".

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

Write the config to \`${a}\`.`):(s=T,n=M||"",i=$,`Modify the MCP server configuration "${s}".

**File to modify:** \`${i}\`

Read the file, then apply these changes:

${n||"Review and improve this MCP configuration. Verify the package exists, update to latest version, and ensure all fields are correct."}

## Rules
- Keep the JSON structure intact
- Update \`version\` (patch increment, e.g. 1.0.0 → 1.0.1)
- Update \`updated\` to today's date
- Keep \`name\` as \`${s}\`
- The file must be valid JSON

Write the updated file back to \`${i}\`.`):"create"===P?(o=k,d=A,l=T,u=S,c=$,p=O,E={claude:"Claude Code",agents:"Agents (Universal)",codex:"Codex CLI",gemini:"Gemini CLI"},`Create a new ${E[o]} ${d} called "${l}".

**Format reference:** \`${p}\`
**Output file:** \`${c}\`

## What it should do
${u}

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
Write the complete file to \`${c}\`.`):(h=k,m=A,f=T,v=M||"",g=$,w=O,`Modify the ${({claude:"Claude Code",agents:"Agents (Universal)",codex:"Codex CLI",gemini:"Gemini CLI"})[h]} ${m} "${f}".

**File to modify:** \`${g}\`
**Format reference:** \`${w}\`

Read the file, then apply these changes:

${v||"Review and improve this asset. Fix any issues, improve clarity, and ensure it follows best practices."}

## Frontmatter rules
- Bump the \`version\` (patch increment, e.g. 1.0.0 → 1.0.1)
- Update \`updated\` to today's date
- Keep all other frontmatter fields intact (\`name\`, \`description\`)
- If any required field is missing, add it

Write the updated file back to \`${g}\`.`),x.NextResponse.json({prompt:b,outputPath:$})}catch(e){return console.error("Asset assistant failed:",e),x.NextResponse.json({error:"Failed to generate assistant prompt",details:String(e)},{status:500})}}e.s(["POST",0,w],82398);var E=e.i(82398);let $=new t.AppRouteRouteModule({definition:{kind:r.RouteKind.APP_ROUTE,page:"/api/cli-assets/assistant/route",pathname:"/api/cli-assets/assistant",filename:"route",bundlePath:""},distDir:".next",relativeProjectDir:"",resolvedPagePath:"[project]/src/app/api/cli-assets/assistant/route.ts",nextConfigOutput:"standalone",userland:E,...{}}),{workAsyncStorage:b,workUnitAsyncStorage:P,serverHooks:k}=$;async function A(e,t,a){a.requestMeta&&(0,s.setRequestMeta)(e,a.requestMeta),$.isDev&&(0,s.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let x="/api/cli-assets/assistant/route";x=x.replace(/\/index$/,"")||"/";let R=await $.prepare(e,t,{srcPage:x,multiZoneDraftMode:!1});if(!R)return t.statusCode=400,t.end("Bad Request"),null==a.waitUntil||a.waitUntil.call(a,Promise.resolve()),null;let{buildId:y,deploymentId:C,params:w,nextConfig:E,parsedUrl:b,isDraftMode:P,prerenderManifest:k,routerServerContext:A,isOnDemandRevalidate:T,revalidateOnlyGenerated:S,resolvedPathname:M,clientReferenceManifest:N,serverActionsManifest:O}=R,I=(0,o.normalizeAppPath)(x),q=!!(k.dynamicRoutes[I]||k.routes[M]),_=async()=>((null==A?void 0:A.render404)?await A.render404(e,t,b,!1):t.end("This page could not be found"),null);if(q&&!P){let e=!!k.routes[M],t=k.dynamicRoutes[I];if(t&&!1===t.fallback&&!e){if(E.adapterPath)return await _();throw new v.NoFallbackError}}let j=null;!q||$.isDev||P||(j="/index"===(j=M)?"/":j);let U=!0===$.isDev||!q,D=q&&!U;O&&N&&(0,i.setManifestsSingleton)({page:x,clientReferenceManifest:N,serverActionsManifest:O});let L=e.method||"GET",H=(0,n.getTracer)(),K=H.getActiveScopeSpan(),Y=!!(null==A?void 0:A.isWrappedByNextServer),F=!!(0,s.getRequestMeta)(e,"minimalMode"),W=(0,s.getRequestMeta)(e,"incrementalCache")||await $.getIncrementalCache(e,E,k,F);null==W||W.resetRequestCache(),globalThis.__incrementalCache=W;let B={params:w,previewProps:k.preview,renderOpts:{experimental:{authInterrupts:!!E.experimental.authInterrupts},cacheComponents:!!E.cacheComponents,supportsDynamicResponse:U,incrementalCache:W,cacheLifeProfiles:E.cacheLife,waitUntil:a.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,r,a,s)=>$.onRequestError(e,t,a,s,A)},sharedContext:{buildId:y,deploymentId:C}},G=new d.NodeNextRequest(e),z=new d.NodeNextResponse(t),J=l.NextRequestAdapter.fromNodeNextRequest(G,(0,l.signalFromNodeResponse)(t));try{let s,i=async e=>$.handle(J,B).finally(()=>{if(!e)return;e.setAttributes({"http.status_code":t.statusCode,"next.rsc":!1});let r=H.getRootSpanAttributes();if(!r)return;if(r.get("next.span_type")!==u.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${r.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let a=r.get("next.route");if(a){let t=`${L} ${a}`;e.setAttributes({"next.route":a,"http.route":a,"next.span_name":t}),e.updateName(t),s&&s!==e&&(s.setAttribute("http.route",a),s.updateName(t))}else e.updateName(`${L} ${x}`)}),o=async s=>{var n,o;let d=async({previousCacheEntry:r})=>{try{if(!F&&T&&S&&!r)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let n=await i(s);e.fetchMetrics=B.renderOpts.fetchMetrics;let o=B.renderOpts.pendingWaitUntil;o&&a.waitUntil&&(a.waitUntil(o),o=void 0);let d=B.renderOpts.collectedTags;if(!q)return await (0,p.sendResponse)(G,z,n,B.renderOpts.pendingWaitUntil),null;{let e=await n.blob(),t=(0,h.toNodeOutgoingHttpHeaders)(n.headers);d&&(t[f.NEXT_CACHE_TAGS_HEADER]=d),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let r=void 0!==B.renderOpts.collectedRevalidate&&!(B.renderOpts.collectedRevalidate>=f.INFINITE_CACHE)&&B.renderOpts.collectedRevalidate,a=void 0===B.renderOpts.collectedExpire||B.renderOpts.collectedExpire>=f.INFINITE_CACHE?void 0:B.renderOpts.collectedExpire;return{value:{kind:g.CachedRouteKind.APP_ROUTE,status:n.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:r,expire:a}}}}catch(t){throw(null==r?void 0:r.isStale)&&await $.onRequestError(e,t,{routerKind:"App Router",routePath:x,routeType:"route",revalidateReason:(0,c.getRevalidateReason)({isStaticGeneration:D,isOnDemandRevalidate:T})},!1,A),t}},l=await $.handleResponse({req:e,nextConfig:E,cacheKey:j,routeKind:r.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:k,isRoutePPREnabled:!1,isOnDemandRevalidate:T,revalidateOnlyGenerated:S,responseGenerator:d,waitUntil:a.waitUntil,isMinimalMode:F});if(!q)return null;if((null==l||null==(n=l.value)?void 0:n.kind)!==g.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==l||null==(o=l.value)?void 0:o.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});F||t.setHeader("x-nextjs-cache",T?"REVALIDATED":l.isMiss?"MISS":l.isStale?"STALE":"HIT"),P&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let u=(0,h.fromNodeOutgoingHttpHeaders)(l.value.headers);return F&&q||u.delete(f.NEXT_CACHE_TAGS_HEADER),!l.cacheControl||t.getHeader("Cache-Control")||u.get("Cache-Control")||u.set("Cache-Control",(0,m.getCacheControlHeader)(l.cacheControl)),await (0,p.sendResponse)(G,z,new Response(l.value.body,{headers:u,status:l.value.status||200})),null};Y&&K?await o(K):(s=H.getActiveScopeSpan(),await H.withPropagatedContext(e.headers,()=>H.trace(u.BaseServerSpan.handleRequest,{spanName:`${L} ${x}`,kind:n.SpanKind.SERVER,attributes:{"http.method":L,"http.target":e.url}},o),void 0,!Y))}catch(t){if(t instanceof v.NoFallbackError||await $.onRequestError(e,t,{routerKind:"App Router",routePath:I,routeType:"route",revalidateReason:(0,c.getRevalidateReason)({isStaticGeneration:D,isOnDemandRevalidate:T})},!1,A),q)throw t;return await (0,p.sendResponse)(G,z,new Response(null,{status:500})),null}}e.s(["handler",0,A,"patchFetch",0,function(){return(0,a.patchFetch)({workAsyncStorage:b,workUnitAsyncStorage:P})},"routeModule",0,$,"serverHooks",0,k,"workAsyncStorage",0,b,"workUnitAsyncStorage",0,P],36688)}];

//# sourceMappingURL=%5Broot-of-the-server%5D__0-65.1h._.js.map