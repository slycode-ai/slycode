module.exports=[82398,e=>{"use strict";var t=e.i(89171),a=e.i(22734),r=e.i(14747),s=e.i(7367),n=e.i(12202);let i=["claude","agents","codex"];async function o(e){try{var o,l,d,u,c,p,h,m,f,v,g,R,C,y,x,w,$,P;let T,A,E,{mode:b,provider:N,assetType:S,assetName:M,description:k,changes:O}=await e.json();if(!b||!N||!S)return t.NextResponse.json({error:"mode, provider, and assetType are required"},{status:400});if(!i.includes(N))return t.NextResponse.json({error:`Unknown provider: ${N}`},{status:400});if("create"===b&&(!M||!k))return t.NextResponse.json({error:"assetName and description are required for create mode"},{status:400});if("modify"===b&&!M)return t.NextResponse.json({error:"assetName is required for modify mode"},{status:400});if(void 0!==M&&!(0,n.validateAssetName)(M))return t.NextResponse.json({error:"Invalid asset name"},{status:400});let I=(0,s.getSlycodeRoot)();if("mcp"===S)A=r.default.join(I,`store/mcp/${M}.json`);else{let e="skill"===S?"skills":"agents",t="skill"===S?`store/${e}/${M}/SKILL.md`:`store/${e}/${M}.md`;A=r.default.join(I,t)}let q=r.default.join(I,"documentation","reference","ai_cli_providers.md");if("modify"===b&&!a.default.existsSync(A)){if("mcp"===S)return t.NextResponse.json({error:`Could not find MCP config '${M}' at ${A}`},{status:404});if("skill"!==S)return t.NextResponse.json({error:`Could not find asset '${M}' in store at ${A}`},{status:404})}return E="mcp"===S?"create"===b?(o=M,l=k,d=A,`Create an MCP (Model Context Protocol) server configuration called "${o}".

**Output file:** \`${d}\`

## What this MCP server should do
${l}

## Research steps

1. Research the MCP server package described above — find the correct npm package name, command, and required arguments
2. Check if there are any required environment variables or setup steps
3. Determine whether this is a stdio MCP (runs locally via command) or HTTP MCP (connects to a URL)

## Store JSON format

There are two transport types. Use the one that matches the MCP server:

### Stdio MCP (runs a local process)
\`\`\`json
{
  "name": "${o}",
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
  "name": "${o}",
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
- \`name\` must be \`${o}\`
- **Stdio**: \`command\` is the executable (usually \`npx\`), \`args\` is an array, \`env\` holds environment variables with \`\${PLACEHOLDER}\` values
- **HTTP**: \`url\` is the MCP server endpoint, \`headers\` is optional (for auth tokens etc.)
- Do NOT include both \`command\` and \`url\` — pick one transport type
- \`description\`, \`version\`, and \`updated\` are required metadata fields
- The file must be valid JSON

Write the config to \`${d}\`.`):(u=M,c=O||"",p=A,`Modify the MCP server configuration "${u}".

**File to modify:** \`${p}\`

Read the file, then apply these changes:

${c||"Review and improve this MCP configuration. Verify the package exists, update to latest version, and ensure all fields are correct."}

## Rules
- Keep the JSON structure intact
- Update \`version\` (patch increment, e.g. 1.0.0 → 1.0.1)
- Update \`updated\` to today's date
- Keep \`name\` as \`${u}\`
- The file must be valid JSON

Write the updated file back to \`${p}\`.`):"create"===b?(h=N,m=S,f=M,v=k,g=A,R=q,T={claude:"Claude Code",agents:"Agents (Universal)",codex:"Codex CLI"},`Create a new ${T[h]} ${m} called "${f}".

**Format reference:** \`${R}\`
**Output file:** \`${g}\`

## What it should do
${v}

## ${m.charAt(0).toUpperCase()+m.slice(1)} format
${({skill:"Skills are SKILL.md files that give the AI specialized knowledge or workflows. They can be invoked via slash commands. They describe when/how to use the skill and can include a references/ subdirectory for supporting files. The skill directory structure is: skillname/SKILL.md and optionally skillname/references/*.md.",agent:"Agents are custom agent definitions that configure specialized behavior, purpose, capabilities, and tool usage."})[m]||""}

Read the format reference for ${T[h]}-specific conventions, then create the ${m}.

## Required frontmatter

\`\`\`yaml
---
name: ${f}
version: 1.0.0
updated: <today's date, YYYY-MM-DD>
description: "<concise one-line summary>"
---
\`\`\`

All four fields are mandatory. The description should summarize the ${m}'s purpose in one line.
${"agents"===h?`
## Provider-Neutral Language

Since this asset targets the universal .agents/ directory (read by cross-tool CLIs such as Codex and OpenCode), you MUST write all text in provider-neutral language:
- Do NOT name specific tools (e.g. "Claude Code" or "Codex CLI")
- Use generic terms like "the AI assistant" or "the agent" instead
- The content should work identically across any AI coding tool that reads .agents/
`:""}
Write the complete file to \`${g}\`.`):(C=N,y=S,x=M,w=O||"",$=A,P=q,`Modify the ${({claude:"Claude Code",agents:"Agents (Universal)",codex:"Codex CLI"})[C]} ${y} "${x}".

**File to modify:** \`${$}\`
**Format reference:** \`${P}\`

Read the file, then apply these changes:

${w||"Review and improve this asset. Fix any issues, improve clarity, and ensure it follows best practices."}

## Frontmatter rules
- Bump the \`version\` (patch increment, e.g. 1.0.0 → 1.0.1)
- Update \`updated\` to today's date
- Keep all other frontmatter fields intact (\`name\`, \`description\`)
- If any required field is missing, add it

Write the updated file back to \`${$}\`.`),t.NextResponse.json({prompt:E,outputPath:A})}catch(e){return console.error("Asset assistant failed:",e),t.NextResponse.json({error:"Failed to generate assistant prompt",details:String(e)},{status:500})}}e.s(["POST",0,o])},36688,e=>{"use strict";var t=e.i(47909),a=e.i(74017),r=e.i(96250),s=e.i(59756),n=e.i(61916),i=e.i(74677),o=e.i(69741),l=e.i(16795),d=e.i(87718),u=e.i(95169),c=e.i(47587),p=e.i(66012),h=e.i(70101),m=e.i(74838),f=e.i(10372),v=e.i(93695),g=e.i(9580);e.i(52474);var R=e.i(220);let C=new t.AppRouteRouteModule({definition:{kind:a.RouteKind.APP_ROUTE,page:"/api/cli-assets/assistant/route",pathname:"/api/cli-assets/assistant",filename:"route",bundlePath:""},distDir:".next",relativeProjectDir:"",resolvedPagePath:"[project]/src/app/api/cli-assets/assistant/route.ts",nextConfigOutput:"standalone",userland:()=>e.r(82398),...{}}),{workAsyncStorage:y,workUnitAsyncStorage:x,serverHooks:w}=C;async function $(e,t,r){r.requestMeta&&(0,s.setRequestMeta)(e,r.requestMeta),C.isDev&&(0,s.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let y="/api/cli-assets/assistant/route";y=y.replace(/\/index$/,"")||"/";let x=await C.prepare(e,t,{srcPage:y,multiZoneDraftMode:!1});if(!x)return t.statusCode=400,t.end("Bad Request"),null==r.waitUntil||r.waitUntil.call(r,Promise.resolve()),null;let{buildId:w,deploymentId:$,params:P,nextConfig:T,parsedUrl:A,isDraftMode:E,prerenderManifest:b,routerServerContext:N,isOnDemandRevalidate:S,revalidateOnlyGenerated:M,resolvedPathname:k,clientReferenceManifest:O,serverActionsManifest:I}=x,q=(0,o.normalizeAppPath)(y),U=!!b.routes[k]&&(C.isDev||(0,g.isRouteCacheOwner)(k,C.cacheOwner,b.routes[k])),_=!!(b.dynamicRoutes[q]||U),D=async()=>((null==N?void 0:N.render404)?await N.render404(e,t,A,!1):t.end("This page could not be found"),null);if(_&&!E){let e=b.dynamicRoutes[q];if(e&&!1===e.fallback&&!U){if(T.adapterPath)return await D();throw new v.NoFallbackError}}let j=null;!_||C.isDev||E||(j="/index"===(j=k)?"/":j);let H=!0===C.isDev||!_,L=_&&!H;I&&O&&(0,i.setManifestsSingleton)({page:y,clientReferenceManifest:O,serverActionsManifest:I});let K=e.method||"GET",F=(0,n.getTracer)(),Y=F.getActiveScopeSpan(),B=!!(null==N?void 0:N.isWrappedByNextServer),W=!!(0,s.getRequestMeta)(e,"minimalMode"),z=(0,s.getRequestMeta)(e,"incrementalCache")||await C.getIncrementalCache(e,T,b,W);null==z||z.resetRequestCache(),globalThis.__incrementalCache=z;let G={params:P,previewProps:b.preview,renderOpts:{experimental:{authInterrupts:!!T.experimental.authInterrupts,useCacheTimeout:T.experimental.useCacheTimeout},cacheComponents:!!T.cacheComponents,validationLevel:T.experimental.instantInsights.validationLevel,isDraftMode:E,supportsDynamicResponse:H,incrementalCache:z,hmrRefreshHash:(0,s.getRequestMeta)(e,"hmrRefreshHash"),cacheLifeProfiles:T.cacheLife,staticPageGenerationTimeout:T.staticPageGenerationTimeout,waitUntil:r.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,a,r,s)=>C.onRequestError(e,t,r,s,N)},sharedContext:{buildId:w,deploymentId:$}},J=new l.NodeNextRequest(e),V=new l.NodeNextResponse(t),X=d.NextRequestAdapter.fromNodeNextRequest(J,(0,d.signalFromNodeResponse)(t)),Z=async({previousCacheEntry:a})=>{try{if(!W&&S&&M&&!a)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let s=await C.handle(X,G);e.fetchMetrics=G.renderOpts.fetchMetrics;let n=G.renderOpts.pendingWaitUntil;n&&r.waitUntil&&(r.waitUntil(n),n=void 0);let i=G.renderOpts.collectedTags;if(!_)return await (0,p.sendResponse)(J,V,s,n),null;{let e=await s.blob(),t=(0,h.toNodeOutgoingHttpHeaders)(s.headers);i&&(t[f.NEXT_CACHE_TAGS_HEADER]=i),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let a=void 0!==G.renderOpts.collectedRevalidate&&!(G.renderOpts.collectedRevalidate>=f.INFINITE_CACHE)&&G.renderOpts.collectedRevalidate,r=void 0===G.renderOpts.collectedExpire||G.renderOpts.collectedExpire>=f.INFINITE_CACHE?!1!==a&&a>0?T.expireTime:void 0:G.renderOpts.collectedExpire;return{value:{kind:R.CachedRouteKind.APP_ROUTE,status:s.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:a,expire:r}}}}catch(t){throw(null==a?void 0:a.isStale)&&await C.onRequestError(e,t,{routerKind:"App Router",routePath:y,routeType:"route",revalidateReason:(0,c.getRevalidateReason)({isStaticGeneration:L,isOnDemandRevalidate:S})},!1,N),t}},Q=async(s,i)=>{try{var o,l;let s=await C.handleResponse({req:e,nextConfig:T,cacheKey:j,routeKind:a.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:b,isRoutePPREnabled:!1,isOnDemandRevalidate:S,revalidateOnlyGenerated:M,responseGenerator:Z,waitUntil:r.waitUntil,isMinimalMode:W});if(!_)return;if((null==s||null==(o=s.value)?void 0:o.kind)!==R.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==s||null==(l=s.value)?void 0:l.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});W||t.setHeader("x-nextjs-cache",S?"REVALIDATED":s.isMiss?"MISS":s.isStale?"STALE":"HIT"),E&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let n=(0,h.fromNodeOutgoingHttpHeaders)(s.value.headers);W&&_||n.delete(f.NEXT_CACHE_TAGS_HEADER),!s.cacheControl||t.getHeader("Cache-Control")||n.get("Cache-Control")||n.set("Cache-Control",(0,m.getCacheControlHeader)(s.cacheControl)),await (0,p.sendResponse)(J,V,new Response(s.value.body,{headers:n,status:s.value.status||200}));return}catch(t){if(t instanceof v.NoFallbackError||await C.onRequestError(e,t,{routerKind:"App Router",routePath:q,routeType:"route",revalidateReason:(0,c.getRevalidateReason)({isStaticGeneration:L,isOnDemandRevalidate:S})},!1,N),_)throw t;await (0,p.sendResponse)(J,V,new Response(null,{status:500}));return}finally{(()=>{if(!s)return;let e=t.statusCode;s.setAttributes({"http.status_code":e,"next.rsc":!1}),e&&e>=500&&(s.setStatus({code:n.SpanStatusCode.ERROR}),s.setAttribute("error.type",e.toString()));let a=F.getRootSpanAttributes();if(!a)return;if(a.get("next.span_type")!==u.BaseServerSpan.handleRequest)return console.warn(`Unexpected root span type '${a.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let r=a.get("next.route")||q,o=`${K} ${r}`;s.setAttributes({"next.route":r,"http.route":r,"next.span_name":o}),s.updateName(o),i&&i!==s&&(i.setAttribute("http.route",r),i.updateName(o))})()}};if(B&&Y)await Q(Y,void 0);else{let t=F.getActiveScopeSpan();await F.withPropagatedContext(e.headers,()=>F.trace(u.BaseServerSpan.handleRequest,{spanName:`${K} ${y}`,kind:n.SpanKind.SERVER,attributes:{"http.method":K,"http.target":e.url}},e=>Q(e,t)),void 0,!B)}}e.s(["handler",0,$,"patchFetch",0,function(){return(0,r.patchFetch)({workAsyncStorage:y,workUnitAsyncStorage:x})},"routeModule",0,C,"serverHooks",0,w,"workAsyncStorage",0,y,"workUnitAsyncStorage",0,x])}];

//# sourceMappingURL=_1erd4cd._.js.map