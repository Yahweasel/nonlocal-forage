import typescript from "@rollup/plugin-typescript";
import nodeResolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import terser from "@rollup/plugin-terser";

export default {
    input: "src/main.ts",
    output: [
        {
            file: "dist/nonlocalforage.js",
            format: "umd",
            name: "NonlocalForage"
        }, {
            file: "dist/nonlocalforage.min.js",
            format: "umd",
            name: "NonlocalForage",
            plugins: [terser()]
        }
    ],
    context: "this",
    plugins: [
        typescript(),
        nodeResolve({
            browser: true
        }),
        commonjs()
    ]
};
