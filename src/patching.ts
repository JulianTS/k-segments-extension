import {patchList, sendPatch} from "./k8s_watcher";
import {patchTime} from "./types";

/**
 * Schedules the memory patches.
 * Takes in startTime and calculates segment changes from predictionArray to find the timestamps of patches
 * Uses 60(Decrease) and 90(Increase) sec buffers for scheduling to prevent insufficient memory errors.
 * Schedules the sendPatch function with setTimeout.
 * @param startTime - Start time of pod in number format
 * @param predictionArray - Memory prediction of pod
 * @param podName - Name of pod
 */
export const scheduleMemoryUpdates = (
    startTime: number,
    predictionArray: number[],
    podName: string
) => {
    const patchBufferTimeIncrease = 90 * 1000; // 90 seconds in milliseconds
    const patchBufferTimeDecrease = 60 * 1000; // 60 seconds in milliseconds
    let previousValue = predictionArray[0];
    let segmentStartTime = startTime;

    const patchTimes: Array<patchTime> = []
    predictionArray.forEach((value: number, index: number) => {
        if (value !== previousValue) {
            const timeToChange = index * 2000; // 2 seconds per step
            const bufferTime =
                value > previousValue
                    ? patchBufferTimeIncrease
                    : patchBufferTimeDecrease;
            const patchTime = segmentStartTime + timeToChange - bufferTime
            patchTimes.push({time: new Date(patchTime), val: value})
            // Schedule the patch request
            const delay = patchTime - Date.now();
            if (delay > 0) {
                setTimeout(() => sendPatch(value, podName), delay);
            }

            previousValue = value;
            segmentStartTime = segmentStartTime + timeToChange;
        }
    });
    patchList.push(podName)
    console.log('scheduling scaling of pod', podName, patchTimes)
};
