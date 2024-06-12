import express, {Request, Response} from "express";
import {getNodeNamesAndLimits, getPrediction, getTaskNameFromLabel, setupK8sWatch} from "./k8s_watcher";
import {FilterRequest, NodeScore, PodSpec} from "./types";
import {readInCsv} from "./csvReader";
import {checkNodeSuitability, NODENAMES} from "./forecast-store";

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware for parsing JSON bodies
app.use(express.json());


export let predictionMap: Map<string, Array<Array<number>>> //taskName format of k8s with ' ' => '_' and without '(' & ')' adapted
const csvFileName = process.env.CSV_FILE || ''; // set env.CSV_FILE or enter local path to prediction files
// adds additional buffer to reduce risk of exitCode 143 and "definition changed, restart"
const MemoryIncrease = 100
// Set prediction map from csv
const setPrediction = async () => {
    try {
        const csvResult: Map<string, Array<Array<number>>> = await readInCsv(csvFileName);
        predictionMap = csvResult
        predictionMap.forEach((value, key) => {
            const updatedArray = value.map(array => array.map(number => number + MemoryIncrease));
            // update map entry
            predictionMap.set(key, updatedArray);
        });
        //console.log('CSV Data as Map:', predictionMap);
        console.log('CSV', csvFileName, 'has been successfully read and increased by ' + MemoryIncrease)
        setupK8sWatch();
        console.log("current memory increase:", MemoryIncrease)
    } catch (error) {
        console.error('Error reading CSV file:', error);
    }
}
export const podLabelDictionary: Map<string, string> = new Map<string, string>()


setPrediction()
getNodeNamesAndLimits()

/**
 * Health probe
 */
app.get("/", (req, res) => {
    res.send("I am alive!");
});

/**
 * Prioritize endpoint for scoring extension of k8s scheduler
 */
app.post("/prioritize", async (req: Request, res: Response) => {
    const body: FilterRequest = req.body
    const pod: PodSpec = body.Pod
    const nodes: Array<string> = NODENAMES
    const scores: NodeScore[] = [];
    const taskName = getTaskNameFromLabel(pod.metadata.labels)
    //console.log('got prioritize request for' + taskName, '!')

    const prediction = taskName ? getPrediction(taskName) : undefined;

    for (const node of nodes) {
        // Preliminary Node Memory Limit

        if (!prediction) {
            scores.push({Host: node, Score: 1});
        } else {
            const enableScoring = true;

            const currentDate: number = Date.now();
            const roundedTime: number = Math.round(currentDate / 2000) * 2000
            const result = checkNodeSuitability(
                node,
                prediction,
                roundedTime,
                enableScoring
            )
            if (result.canFit) {
                scores.push({Host: node, Score: result.score || 1})
            }
        }
    }
    //console.log('scores', scores)
    res.json(scores);
});

/**
 * Filter endpoint for scoring extension of k8s scheduler
 */
app.post("/filter", async (req: Request, res: Response) => {
    const body: FilterRequest = req.body
    const nodes: Array<string> = NODENAMES
    const suitableNodeNames: Array<string> = [];
    const pod: PodSpec = body.Pod
    const taskName = getTaskNameFromLabel(pod.metadata.labels)
    //console.log('got filter request for ' + taskName, '!')
    const prediction = taskName ? getPrediction(taskName) : undefined;
    //if(prediction) console.log('found prediction for', taskName)

    if (!nodes) {
        res.json({
            NodeNames: {},
            FailedNodes: {},
            Error: ""
        });
        return
    }

    for (const node of nodes) {
        if (!prediction) {
            suitableNodeNames.push(node);
        } else {
            const enableScoring = false;
            const currentDate: number = Date.now();
            const roundedTime: number = Math.round(currentDate / 2000) * 2000
            const result = checkNodeSuitability(
                node,
                prediction,
                roundedTime,
                enableScoring
            )
            if (result.canFit) {
                suitableNodeNames.push(node)
            }
        }
    }

    const response = {
        NodeNames: suitableNodeNames,
        FailedNodes: {},
        Error: ""
    };

    res.json(response);
})

/*
For retrieving pod name => task name key value pairs
 */
app.get("/label", (req, res) => {
    const obj = Object.fromEntries(podLabelDictionary);
    res.json(obj);
});

app.listen(PORT, () => {
    console.log(`Scheduler extension listening on port ${PORT}`);
});