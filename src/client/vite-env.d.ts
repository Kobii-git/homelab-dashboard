/// <reference types="vite/client" />

declare const __APP_GIT_SHA__: string;

declare module "guacamole-common-js" {
  const Guacamole: any;
  export default Guacamole;
}
