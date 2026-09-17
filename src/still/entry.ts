// Detached inspection must never start another data client, poller or decision loop.
if(new URL(location.href).searchParams.has('developer-console')){
  const {startConsoleWindow}=await import('./detached-console.ts');startConsoleWindow();
}else{
  await import('./app.ts');document.body.append(document.createElement('still-app'));
}
export {};
