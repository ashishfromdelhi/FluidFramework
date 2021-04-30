/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

// eslint-disable-next-line unicorn/filename-case
import fs from "fs";
import child_process from "child_process";
import commander from "commander";
import { TestDriverTypes } from "@fluidframework/test-driver-definitions";
import { ILoadTestConfig, ITestConfig, ITestTenant } from "./testConfigFile";
import { createTestDriver, getProfile, initialize, safeExit } from "./utils";
// import { createTestDriver, getProfile, initialize } from "./utils";
async function main() {
    commander
        .version("0.0.1")
        .requiredOption("-t, --tenant <tenant>", "Which test tenant info to use from testConfig.json", "fluidCI")
        .requiredOption("-d, --driver <driver>", "Which test driver info to use", "odsp")
        .requiredOption("-p, --profile <profile>", "Which test profile to use from testConfig.json", "ci")
        .option("-id, --testId <testId>", "Load an existing data store rather than creating new")
        .option("-s, --seed <number>", "Seed for this run")
        .option("-dbg, --debug", "Debug child processes via --inspect-brk")
        .option("-l, --log <filter>", "Filter debug logging. If not provided, uses DEBUG env variable.")
        .option("-v, --verbose", "Enables verbose logging")
        .option("-ik, --instrumentationKey <instrumentationKey>", "Azure app insight instrumentation key.")
        .option("-u, --url <url>"," <url>")
        .option("-t, --tenant <tenant>", "Which test tenant info to use from testConfig.json", "fluidCI")
        .option("-z, --numDoc <numDoc>", "If it is not provided then default value as 1 will be used.")
        .option("-pid, --podId <podId>", "If it is not provided then default value as 1 will be used.")
        .parse(process.argv);

    const driver: TestDriverTypes = commander.driver;
    const profileArg: string = commander.profile;
    const tenantArg: string = commander.tenant;
    const testId: string | undefined = commander.testId;
    const debug: true | undefined = commander.debug;
    const log: string | undefined = commander.log;
    const verbose: true | undefined = commander.verbose;
    const seed: number | undefined = commander.seed;
    const instrumentationKey: string | undefined = commander.instrumentationKey;
    const url: string | undefined = commander.url;
    // const numDoc: number | undefined = commander.numDoc === undefined ? 1 : parseInt(commander.numDoc, 10);
    const profile = getProfile(profileArg);
    let podId = 1;
    if (commander.podId !== undefined) {
        podId = parseInt(commander.podId,10);
    }
    if (log !== undefined) {
        process.env.DEBUG = log;
    }
    // Fetch User and Password and Set the Enviroment Variable
    let config: ITestConfig;
    try {
        config = JSON.parse(fs.readFileSync("./testConfigUser.json", "utf-8"));
    } catch (e) {
        console.error("Failed to read testConfigUser.json");
        console.error(e);
        // process.exitCode = EXIT_ERROR.FAILED_TO_READ_TESTCONFIGUSER;
        return;
    }
    const tenant: ITestTenant | undefined = config.tenants[tenantArg];
    if (tenant === undefined) {
        console.error("Invalid --tenant argument not found in testConfig.json tenants");
        // process.exitCode = EXIT_ERROR.INVALID_TENANT;
        return;
    }
    const passwords: { [user: string]: string } =
        JSON.parse(fs.readFileSync("./loginOdspTestAccounts.json", "utf-8"));
    const user_ind: number = podId % tenant.usernames.length;
    const user_ = tenant.usernames[user_ind];
    const password = passwords[user_];
    console.log(`${podId} ==== ${tenant.usernames.length} ==== ${passwords[user_]}`);
    console.log(`${user_}  ${password}`);
    process.env.login__odsp__test__accounts = `{"${user_}":"${password}"}`;
    // process.env.login__odsp__test__accounts = "{\"${}\":\"\"}";
    await orchestratorProcess(
            driver,
            { ...profile, name: profileArg },
            { testId, debug, verbose, seed, instrumentationKey, url});
}
/**
 * Implementation of the orchestrator process. Returns the return code to exit the process with.
 */
async function orchestratorProcess(
    driver: TestDriverTypes,
    profile: ILoadTestConfig & { name: string },
    args: { testId?: string, debug?: true, verbose?: true, seed?: number, instrumentationKey?: string, url?: string},
) {
    const currentdate = new Date();
    const startDatetime = `Last Sync: `
        + `${currentdate.getDate().toString()}`
        + `/${(currentdate.getMonth() + 1).toString()}`
        + `/${currentdate.getFullYear().toString()}`
        + ` @ ${currentdate.getHours().toString()}`
        + `:${currentdate.getMinutes().toString()}`
        + `:${currentdate.getSeconds().toString()}`;
    const seed = args.seed ?? Date.now();
    const testDriver = await createTestDriver(
        driver,
        seed,
        undefined);
    // Create a new file if a testId wasn't provided
    const url = args.testId !== undefined
        ? await testDriver.createContainerUrl(args.testId)
        : await initialize(testDriver, seed);

    const estRunningTimeMin = Math.floor(2 * profile.totalSendCount / (profile.opRatePerMin * profile.numClients));
    console.log(`Connecting to ${args.testId ? "existing" : "new"} with seed 0x${seed.toString(16)}`);
    console.log(`Container targeting with url:\n${url }`);
    console.log(`Selected test profile: ${profile.name}`);
    console.log(`Estimated run time: ${estRunningTimeMin} minutes\n`);
    // const user = "user11@a830edad9050849829J20060312.onmicrosoft.com";
    // const password = "Hpop1234";
    const runnerArgs: string[][] = [];
    // const user_logins: string[] = ["user5@a830edad9050849829J21021520.onmicrosoft.com",
    //  "user6@a830edad9050849829J21021520.onmicrosoft.com"];
    // process.env['login__odsp__test__accounts'] = 'production';
    for (let i = 0; i < profile.numClients; i++) {
        const childArgs: string[] = [
            "./dist/runner.js",
            "--driver", driver,
            "--profile", profile.name,
            "--runId", i.toString(),
            "--url", url,
            "--seed", `0x${seed.toString(16)}`,
        ];
        // const str1 = "login__odsp__test__accounts = ";
        // const user = user_logins[i];
        // const password = "Hpop1234";
        // childArgs.unshift(`${str1}'{"${user}":"${password}"}' node`);
        if (args.debug) {
            const debugPort = 9230 + i; // 9229 is the default and will be used for the root orchestrator process
            childArgs.unshift(`--inspect-brk=${debugPort}`);
        }

        if(args.verbose) {
            childArgs.push("--verbose");
        }

        if (args.instrumentationKey) {
            childArgs.push(`--instrumentationKey=${args.instrumentationKey}`);
        }
        console.log(childArgs.join(" "));
        runnerArgs.push(childArgs);
    }
    console.log(`${runnerArgs[0].join(" ")}`);
    try{
        await Promise.all(runnerArgs.map(async (childArgs)=>{
            const process = child_process.spawn(
                "node",
                childArgs,
                // {   env:{ login__odsp__test__accounts: "{\"user3@a830edad9050849829J21021520.onmicrosoft.com\"" +
                //  ":\"Hpop1234\"}"},
                {stdio: "inherit"},
            );
            return new Promise((resolve) => process.once("close", resolve));
        }));
    } finally{
        await safeExit(0, url);
    }
    const currentdate_end = new Date();
    const endDatetime = `Last Sync: `
        + `${currentdate_end.getDate().toString()}`
        + `/${(currentdate_end.getMonth() + 1).toString()}`
        + `/${currentdate_end.getFullYear().toString()}`
        + ` @ ${currentdate_end.getHours().toString()}`
        + `:${currentdate_end.getMinutes().toString()}`
        + `:${currentdate_end.getSeconds().toString()}`;
    console.log(`Start Time : ${startDatetime}`);
    console.log(`End Time : ${endDatetime}`);

    console.log(`Test completed`);
}

main().catch(
    (error) => {
        console.error(error);
        process.exit(-1);
    },
);
