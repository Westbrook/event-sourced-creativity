// Runs before either application entry. Each loaded tab pins its own user;
// switching another tab cannot redirect an in-flight edit to a different user.
(() => {
 const originalFetch=window.fetch.bind(window);
 let selected='primary';
 try { selected=sessionStorage.getItem('still-pilot-test-user')||'primary'; } catch { /* Primary remains usable without tab storage. */ }
 window.fetch=(input,init)=>{
  const request=new Request(input instanceof Request?input:new URL(input,location.href),init);
  const url=new URL(request.url);
  if(url.origin===location.origin&&url.pathname.startsWith('/api/')){
   const headers=new Headers(request.headers);headers.set('x-still-test-user',selected);
   return originalFetch(new Request(request,{headers}));
  }
  return originalFetch(request);
 };
})();
