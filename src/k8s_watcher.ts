import * as k8s from "@kubernetes/client-node";
import {V1NodeList} from '@kubernetes/client-node'; // Adjust the import according to your library
import {scheduleMemoryUpdates} from "./patching";
import {podLabelDictionary, predictionMap} from "./index";
import {
    addPodWithoutPrediction,
    checkNodeSuitability,
    removePodWithoutPrediction,
    setNodes,
    writePodPredictions
} from "./forecast-store";
import * as http from "http";
import {Labels} from "./types";

const kc = new k8s.KubeConfig();
if (process.env.CONFIG_BOOLEAN) {
    kc.loadFromCluster();
} else {
    kc.loadFromFile(""); // set local path of service kubeconfig here if the extension is not running inside a cluster
}
const k8sApi = kc.makeApiClient(k8s.CoreV1Api);


//to prevent patching already deleted pods
export const patchList: Array<string> = []

// to keep track of which pod already got scheduled.
const historicalPods: Array<string> = [];

let count = 0;

/**
 * Watches / Listens to Kubernetes' pod events in default namespace
 */
export const setupK8sWatch = () => {
    const watch = new k8s.Watch(kc);
    const namespace: string = "cws";

    // just for observation
    watch.watch(
        `/api/v1/namespaces/${namespace}/pods`,
        {},
        async (type, obj: k8s.V1Pod) => {

            const i = count++;
            const labels = obj.metadata?.labels
            if (!labels) return
            const taskName = getTaskNameFromLabel(labels)

            if (taskName) {

                console.log(
                    i,
                    taskName,
                    obj.status?.phase,
                    obj.spec?.containers[0].resources?.requests,
                    obj.status?.resize,
                    new Date(),
                    //JSON.stringify(obj.status),
                );
                const podName = obj.metadata?.name


                if (!podName) return; // stop when podName is undefined

                if (obj.status?.phase?.toLowerCase() === "failed") {
                    // if a previously scaled pod fails, it is most likely caused by the prediction, so it is removed to not interfere again

                    if (podName) {
                        removePodWithoutPrediction(podName)
                        removeFromPatchList(podName)
                    }

                } else if (obj.status?.phase?.toLowerCase() === "succeeded") {
                    // succeeded pod is not needed anymore
                    if (podName) {
                        removeFromPatchList(podName)
                        removePodWithoutPrediction(podName)
                    }
                }
                if (type === "DELETED") {
                    // Additional logic for DELETED if needed
                } else if (type === "ADDED") {
                    // Additional logic for ADDED if needed
                    addToDictionary(podName, taskName)
                } else if (
                    type === "MODIFIED" &&
                    obj.status?.phase == "Running" &&
                    !historicalPods.includes(podName)
                ) {
                    historicalPods.push(podName);
                    // round current time for correct use for influxDB
                    const currentDate: number = Date.now();
                    const roundedTime: number = Math.round(currentDate / 2000) * 2000

                    // get prediction Array from the map
                    const predictionsArray = getPrediction(taskName);
                    if (!predictionsArray) console.log("no prediction found for", taskName)

                    const nodeName = obj.spec?.nodeName;

                    if (!nodeName) {
                        console.log("node name not found for task:", taskName)
                        return
                    }

                    if (!predictionsArray || predictionsArray.length < 480 / 2) { // if no prediction available or runtime smaller than 480s
                        const memoryString: string = JSON.parse(JSON.stringify(obj.spec?.containers[0].resources?.requests)).memory
                        if (!memoryString) {
                            throw new Error(`memory of '${taskName}' not found`);
                        }
                        const memoryNumber = convertMemoryToMi(memoryString)
                        if (memoryNumber <= 0) {
                            throw new Error(`memory of'${taskName}' is zero: ${memoryNumber}`);
                        }
                        addPodWithoutPrediction(podName, nodeName, memoryNumber)
                        return
                    }
                    // if runtime of prediction is smaller than 480s, it cant be scheduled correctly
                    if (predictionsArray && predictionsArray.length >= 480 / 2) {
                        // write to DB
                        const {
                            canFit
                        } = checkNodeSuitability(nodeName, predictionsArray, roundedTime, false)
                        if (!canFit) {
                            // optional logic for that case
                            console.log('ERROR: NODE LIMIT REACHED')
                        }
                        writePodPredictions(nodeName, taskName, predictionsArray, roundedTime);
                        scheduleMemoryUpdates(roundedTime, predictionsArray, podName);

                        // remove prediction / update predictionmap for future tasks, as this is guaranteed to be in time for the next pod
                        // otherwise place in "failed" case
                        deleteRecentPrediction(taskName)
                    }
                }
            }
        },
        (err) => {
            console.log("K8s Watch Error: ", err, "; restarting");
            setupK8sWatch();
        }
    );
}

/**
 * Sending memory pod patches directly to the k8s-apiserver
 * @param newMemoryValue - New value for pod's memory resource in the next segment
 * @param podName - Name of pod that has to be patched
 */
export const sendPatch = async (newMemoryValue: number, podName: string) => {
    const namespace = "cws";
    if (!patchList.includes(podName)) {
        console.log("sendPatch of pod", podName, "stopped")
        return
    }
    const patchMem = (Math.ceil(newMemoryValue)); // before just math.ceil
    //console.log("send patch", podName, newMemoryValue)
    try {
        const patch: k8s.V1Pod = {
            spec: {
                containers: [
                    {
                        name: podName,
                        resources: {
                            requests: {
                                memory: "" + patchMem + "Mi",
                            },
                            limits: {
                                memory: "" + patchMem + "Mi",
                            },
                        },
                    },
                ],
            },
        };
        const options = {
            headers: {"Content-type": "application/strategic-merge-patch+json"},
        };
        const podPatchRes = await k8sApi.patchNamespacedPod(
            podName,
            namespace,
            patch,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            options
        );
        //console.log("Patch of pod", podName, ": ", podPatchRes.body.status?.resize);
    } catch (err) {
        console.error("send patch error: ", err);
    }
}

const memoryUnits: Map<string, number> = new Map([
    ['Mi', 1],
    ['Gi', 1000],
    ['Ki', 1 / 1000],
]);

/**
 * Takes last to characters of memory string to get unit and calculate Mi value
 * @param memoryString - Memory string from K8s api with Gi/Mi/Ki units as last two characters
 * @return - Memory value in "Mi"
 */
const convertMemoryToMi = (memoryString: string): number => {
    const unit: string = memoryString.slice(-2);
    const value: number = Number(memoryString.slice(0, -2));
    if (memoryUnits.has(unit)) {
        return value * <number>memoryUnits.get(unit);
    } else {
        throw new Error(`Unknown unit: ${unit}`);
    }

}

/**
 * Function to get all node names and their limits from the K8s api.
 * Updates variables for forecast-store afterwards.
 */
export const getNodeNamesAndLimits = () => {
    const nameAndCapacity = new Map<string, number>()
    console.log('initialize nodes...')
    k8sApi.listNode()
        .then((result: { response: http.IncomingMessage, body: V1NodeList }) => {
            result.body.items.forEach(node => {
                const allocatable = node.status?.allocatable
                if (allocatable && node.metadata?.name) {
                    nameAndCapacity.set(<string>node.metadata?.name, convertMemoryToMi(allocatable.memory))
                }
            });
            setNodes(nameAndCapacity)
        })
        .catch(err => {
            console.error('Error listing nodes:', err);
        });
}

/**
 * Function to log current node capacities
 * @param nodename - name of node in string format
 * @param taskName - name of task in string format
 */
export const getNodeCapacityLOG = async (nodename: string, taskName: string) => {
    const nameAndCapacity = new Map<string, number>()
    k8sApi.listNode()
        .then((result: { response: http.IncomingMessage, body: V1NodeList }) => {
            result.body.items.forEach(node => {
                const allocatable = node.status?.allocatable
                if (allocatable && node.metadata?.name) {
                    nameAndCapacity.set(<string>node.metadata?.name, convertMemoryToMi(allocatable.memory))
                }
            });
            console.log(taskName, "patch proposed, current node capacity: ", nameAndCapacity.get(nodename))
        })
        .catch(err => {
            console.error('Error listing nodes:', err);
        });
}

/**
 * Function to retrieve the taskname from pods of different nextflow versions
 * @param labels - label of pod object
 * @return - task name from label in string format or undefined
 */
export const getTaskNameFromLabel = (labels: Labels): string | undefined => {
    if (process.env.WORKFLOWNAME && process.env.WORKFLOWNAME.toLowerCase() === "sarek") {
        return <string>labels['nextflow.io/taskName']; // for sarek!!!
    } else {
        return <string>labels.taskName
    }
}

/**
 * Function to remove a pod from the patch list
 * @param podName - name of pod
 */
export const removeFromPatchList = (podName: string): void => {
    const index = patchList.indexOf(podName)
    if (index > -1) {
        patchList.splice(index, 1);
    }
}

/**
 * Function to add pod name and task label as key value pair to dictionairy
 * @param podName - name of pod
 * @param taskName - task name from label
 */
const addToDictionary = (podName: string, taskName: string): void => {

    if (!podLabelDictionary.has(podName)) {
        podLabelDictionary.set(podName, taskName)
    }

}

/**
 * Function to retrieve first prediction of a pod from the prediction map
 * @param taskName - task name
 * @return - Pod prediction as Array
 */
export const getPrediction = (taskName: string): Array<number> | undefined => {
    const allPredictions = predictionMap.get(taskName)
    if (allPredictions && allPredictions.length >= 1) {
        return allPredictions[0]
    } else {
        return
    }
}

/**
 * Function to delete most recent / first prediction from the prediction map
 * @param taskName - task name
 */
export const deleteRecentPrediction = (taskName: string): void => {
    const allPredictions = predictionMap.get(taskName);
    if (allPredictions) {
        if (allPredictions.length === 1) {
            predictionMap.delete(taskName);
        } else {
            // Wenn das Array mehr als ein Element enthält, entferne das erste Element
            // und aktualisiere die Map mit dem neuen Array
            const updatedPredictions = allPredictions.slice(1);
            predictionMap.set(taskName, updatedPredictions);
        }
    } else {
        console.log(`Keine Vorhersagen gefunden für ${taskName}`);
    }
};