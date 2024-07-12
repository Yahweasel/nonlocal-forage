all: dist/nonlocalforage.js dist/nonlocalforage.min.js

dist/nonlocalforage.js dist/nonlocalforage.min.js: src/*.ts node_modules/.bin/rollup
	npm run build

node_modules/.bin/rollup:
	npm install

clean:
	rm -rf dist
