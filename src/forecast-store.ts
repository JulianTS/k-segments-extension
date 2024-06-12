import {NodeSuitabilityResult} from "./types";
import AsyncLock from "async-lock";

const lock = new AsyncLock();
// Maps for each node
const nodesTimeStamps: Map<string, Map<number, number>> = new Map(); // Map with (node name => Map (TimestampNumber => predicted memory))
let nodeLimitMap: Map<string, number> //Map with (node name => Node Memory Limit)
export const NODENAMES: Array<string> = []
// Initialize maps for each node
export const setNodes = (nodesAndLimits: Map<string, number>) => {
    nodesAndLimits.forEach((limit: number, nodeName: string) => {
        nodesTimeStamps.set(nodeName, new Map<number, number>());
        NODENAMES.push(nodeName)
    })
    nodeLimitMap = nodesAndLimits
    console.log('nodes intialized!')
    console.log("nodes and limits:", nodeLimitMap)
}

interface PodTrackNonPred {
    nodeName: string;
    memoryUsage: number;
}

// Map to keep track of active pods without predictions
const activePodsWithoutPredictions = new Map<string, PodTrackNonPred>(); //TODO might be great to keep track of pod and task name
export let sizeWithoutPredictions = 0

/**
 * Checks if node still has future memory capacity left for the new pod.
 * @param nodeName - Name of the according Node
 * @param podPrediction - prediction array of pod
 * @param startTime - Start time in number format of pod
 * @param enableScoring - Enables the return of scores for the nodes
 */
export const checkNodeSuitability = (
    nodeName: string,
    podPrediction: Array<number>,
    startTime: number,
    enableScoring = false
): NodeSuitabilityResult => {
    const nodeData = nodesTimeStamps.get(nodeName);
    if (!nodeData) {
        throw new Error(`Node '${nodeName}' not found`);
    }

    const nodeMemoryLimit = nodeLimitMap.get(nodeName)
    if (!nodeMemoryLimit) {
        return {canFit: false};
    }
    const duration = podPrediction.length * 2000; // Duration in milliseconds
    const stopTime = startTime + duration
    const nodeDataPoints: Array<number> = []

    // get nodes memory over pod runtime
    for (let i = startTime; i <= stopTime; i += 2000) {
        nodeDataPoints.push(nodeData.get(i) || 0)
    }

    let memoryOverLimit = false;
    let totalAvailableMemory = 0;

    for (let i = 0; i < podPrediction.length; i++) {
        const nodeMemoryUsage = nodeDataPoints[i]
        const podMemoryUsage = (Math.ceil(podPrediction[i] / 100) * 100) - 1
        const totalMemoryUsage = nodeMemoryUsage + podMemoryUsage + sumMemoryOnNode(nodeName);
        if (totalMemoryUsage > nodeMemoryLimit) {
            memoryOverLimit = true;
            break;
        }
        // Optional scoring
        if (enableScoring) {
            totalAvailableMemory += nodeMemoryLimit - totalMemoryUsage;
        }
    }

    const score = enableScoring ? totalAvailableMemory / podPrediction.length : undefined;
    // console.log(memoryOverLimit ? "cannot fit!" : "can fit!");
    return {canFit: !memoryOverLimit, score};
};


/**
 * Function to write prediction into the forecast store. Could also be used to write into a time series DB
 * @param nodeName - Name of node
 * @param taskName - Name of pod
 * @param predictionsArray - Memory prediction of pod in array format
 * @param startTime - Start time of pod in number format
 */
export const writePodPredictions = (nodeName: string, taskName: string, predictionsArray: Array<number>, startTime: number): void => {

    const nodeData = nodesTimeStamps.get(nodeName);
    if (!nodeData) {
        throw new Error(`Node '${nodeName}' not found`);
    }

    const timeStep = 2000; // 2 seconds in milliseconds
    if (!Array.isArray(predictionsArray)) {
        console.error(`writePodPredictions: predictionsArray is not an array, received:`, typeof predictionsArray);
        return; // or handle this case as needed
    }
    predictionsArray.forEach((prediction, index) => {
        prediction = (Math.ceil(prediction / 100) * 100) - 1
        const key = startTime + index * timeStep
        if (nodeData.has(key)) {
            // Key exists, increase its value
            nodeData.set(key, <number>nodeData.get(key) + prediction);
        } else {
            // Key doesn't exist, add it with the initial value
            nodeData.set(key, prediction);
        }
    })
    console.log(`Prediction for pod '${taskName}' from ${formatDateTime(startTime)} to ${formatDateTime(startTime + predictionsArray.length * timeStep)} added`);

}

/**
 * Helper function to format the date of output into a readable string
 * @param timestamp - time in number format
 */
const formatDateTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour12: false
    });
};

/**
 * Function to add the memory of a pod into sizeWithoutPredictions
 * @param podId - pod name
 * @param nodeName - node name
 * @param memoryUsage - memory usage in Bytes
 */
export const addPodWithoutPrediction = (podId: string, nodeName: string, memoryUsage: number): void => {
    activePodsWithoutPredictions.set(podId, {nodeName, memoryUsage});
    sizeWithoutPredictions += memoryUsage
}

/**
 * Function to remove a pod's memory usage when it terminates. Using async lock to not prevent any race conditions
 * @param podId - Pod's actual pod name!
 */
export const removePodWithoutPrediction = (podId: string): void => {
    lock.acquire('key', function () {
        const memoryUsage = activePodsWithoutPredictions.get(podId)?.memoryUsage;
        if (activePodsWithoutPredictions.delete(podId) && memoryUsage) {
            sizeWithoutPredictions -= memoryUsage
        }
    }, function (err) {
        if (err) console.log('lock error:', err?.message)
    });
}

/**
 * Function to sum together the total memory blocked on a node
 * @param nodeName - name of the specific node
 */
const sumMemoryOnNode = (nodeName: string) => {
    let totalMemory = 0;
    activePodsWithoutPredictions.forEach((podInfo: PodTrackNonPred) => {
        if (podInfo.nodeName === nodeName) {
            totalMemory += podInfo.memoryUsage;
        }
    });
    return totalMemory;
}

/*
 Cleanup function to remove 5min old timestamps from the forecast store, to minimize time and complexity of the functions above
 */
const cleanupOldTimestamps = (): void => {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000; // 5 minutes in milliseconds

    nodesTimeStamps.forEach((nodeMap, nodeName) => {
        for (const timestamp of nodeMap.keys()) {
            if (timestamp < fiveMinutesAgo) {
                nodeMap.delete(timestamp);
            } else {
                // Break the loop once we reach a timestamp more recent than the threshold
                break;
            }
        }
        console.log(`Cleaned up old timestamps for node '${nodeName}'`);
    });
};


// Cleanup scheduled to run every 10 minutes
setInterval(cleanupOldTimestamps, 10 * 60 * 1000);
