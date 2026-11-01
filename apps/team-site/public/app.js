const landing = location.pathname === "/" || location.pathname === "";
const module = landing
  ? import("./app/views/landing.js").then(({ bootstrapLanding }) => bootstrapLanding())
  : import("./app/views/app.js").then(({ bootstrap }) => bootstrap());

module.catch((error) => {
  document.body.innerHTML = `<main class="fatal-error">${String(error?.message || error)}</main>`;
});
