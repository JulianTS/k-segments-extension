# K-Segments-Extension

Master Project: Nodejs express server that dynamically scales nextflow pods with the help of files derived from the k-segments prediction model

The experiment has been conducted with the extension running in a Docker container. 

## Run server
For local execution install dependencies with:
```
yarn install
```
Then add a path to the prediction in `src/index.ts` and a path to the kubeconfig in `src/k8s_watcher.ts` or use the environment variables.

To start the server, execute:

```
yarn start
```


