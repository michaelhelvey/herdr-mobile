declare module "*.css";

/** A file that the bundler copies. The import gives the path of the file. */
declare module "*.png" {
  const path: string;
  export default path;
}

/** A file that the bundler copies. The import gives the path of the file. */
declare module "*.webmanifest" {
  const path: string;
  export default path;
}

/** A file that the bundler copies. The import gives the path of the file. */
declare module "*.svg" {
  const path: string;
  export default path;
}
