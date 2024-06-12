import * as fs from 'fs';
import csv from 'csv-parser';
import * as path from 'path';


/**
 * Reads in prediction CSV file and returns Map as promise. Workflow name gets transformed to the same style as the pod's label.taskname
 * @param csvFilePath - Path to CSV file.
 * @returns - Promise of a Map with workflow name as key and its prediction as value.
 */
export const readInCsv = (csvFilePath: string): Promise<Map<string, Array<Array<number>>>> => {

    const csvFilePathAbsolute = path.resolve(__dirname, csvFilePath);

    return new Promise((resolve, reject) => {
        const results: Map<string, Array<Array<number>>> = new Map();

        //Assuming Prediction_last is a String
        fs.createReadStream(csvFilePathAbsolute)
            .pipe(csv())
            .on('data', (data) => results.set(data.Workflow.replace("(", "").replace(")", "").replace(" ", "_").split(" ")[0], JSON.parse(data.Predictions)))
            .on('end', () => {
                resolve(results);
            })
            .on('error', (err) => {
                reject(err);
            });

        console.log("finished reading in " + csvFilePathAbsolute)
    });
};
