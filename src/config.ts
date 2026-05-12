import { createMeshConfig } from "@baditaflorin/mesh-common";

export const config = createMeshConfig({
  appName: "mesh-orientation-mosaic",
  description: "Group puzzle — phones held at specific angles combine into one hidden image",
  accentHex: "#f0932b",
  version: __APP_VERSION__,
  commit: __GIT_COMMIT__,
});
