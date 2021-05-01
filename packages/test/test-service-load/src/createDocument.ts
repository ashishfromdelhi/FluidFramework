// import child_process from "child_process";
import fs from "fs";
import commander from "commander";
import { TestDriverTypes } from "@fluidframework/test-driver-definitions";
import { ILoadTestConfig, ITestConfig, ITestTenant } from "./testConfigFile";
import { createTestDriver, getProfile, initialize } from "./utils";

async function main() {
    commander
        .version("0.0.1")
        .requiredOption("-d, --driver <driver>", "Which test driver info to use", "odsp")
        .requiredOption("-p, --profile <profile>", "Which test profile to use from testConfig.json", "ci")
        .requiredOption("-t, --tenant <tenant>", "Provide you tenant")
        .requiredOption("-z, --numDoc <numDoc>", "should be integer")
        .option("-id, --testId <testId>", "Load an existing data store rather than creating new")
        .option("-s, --seed <number>", "Seed for this run")
        .option("-dbg, --debug", "Debug child processes via --inspect-brk")
        .option("-l, --log <filter>", "Filter debug logging. If not provided, uses DEBUG env variable.")
        .option("-v, --verbose", "Enables verbose logging")
        // .option("-ik, --instrumentationKey <instrumentationKey>", "Azure app insight instrumentation key.")
        .parse(process.argv);

    const driver: TestDriverTypes = commander.driver;
    const profileArg: string = commander.profile;
    const tenantArg: string = commander.tenant;
    const testId: string | undefined = commander.testId;
    const debug: true | undefined = commander.debug;
    const log: string | undefined = commander.log;
    const verbose: true | undefined = commander.verbose;
    const seed: number | undefined = commander.seed;
    const numDoc: number = parseInt(commander.numDoc, 10);
    // const instrumentationKey: string | undefined = commander.instrumentationKey;

    const profile = getProfile(profileArg);

    if (log !== undefined) {
        process.env.DEBUG = log;
    }
    await orchestratorProcess(
            driver,
            { ...profile, name: profileArg, tenantArgs: tenantArg, numDocs: numDoc},
            { testId, debug, verbose, seed});
    console.log(`Test Completed`);
    process.exit(0);
}
/**
 * Implementation of the orchestrator process. Returns the return code to exit the process with.
 */
async function orchestratorProcess(
    driver: TestDriverTypes,
    profile: ILoadTestConfig & { name: string } & { tenantArgs: string} & { numDocs: number},
    args: { testId?: string, debug?: true, verbose?: true, seed?: number},
) {
    let config: ITestConfig;
    try {
        config = JSON.parse(fs.readFileSync("./testConfigUser.json", "utf-8"));
    } catch (e) {
        console.error("Failed to read testConfigUser.json");
        console.error(e);
        // process.exitCode = EXIT_ERROR.FAILED_TO_READ_TESTCONFIGUSER;
        return;
    }
    const tenant: ITestTenant | undefined = config.tenants[profile.tenantArgs];
    if (tenant === undefined) {
        console.error("Invalid --tenant argument not found in testConfig.json tenants");
        // process.exitCode = EXIT_ERROR.INVALID_TENANT;
        return;
    }
    // console.log(`${tenant}`);
    const passwords: { [user: string]: string } =
        JSON.parse(fs.readFileSync("./loginOdspTestAccounts.json", "utf-8"));
    // process.env.login__odsp__test__accounts = "{\"${}\":\"\"}";

    const currentdate = new Date();
    const startDatetime = `Last Sync: `
        + `${currentdate.getDate().toString()}`
        + `/${(currentdate.getMonth() + 1).toString()}`
        + `/${currentdate.getFullYear().toString()}`
        + ` @ ${currentdate.getHours().toString()}`
        + `:${currentdate.getMinutes().toString()}`
        + `:${currentdate.getSeconds().toString()}`;
    const urlsLen = config.tenants[profile.tenantArgs]?.docUrls.length;
    config.tenants[profile.tenantArgs]?.docUrls.splice(0,urlsLen);
    for (let user_index = 0; user_index < profile.numDocs; user_index++) {
        const user_ind: number = user_index % tenant.usernames.length;
        const user_ = tenant.usernames[user_ind];
        const password = passwords[user_];
        // console.log(`${podId} === ${numDoc} ==== ${tenant.usernames.length} ==== ${passwords[user_]}`);
        // console.log(`${user_}  ${password}`);
        process.env.login__odsp__test__accounts = `{"${user_}":"${password}"}`;
        const seed = Date.now();
        console.log(`testId : ${driver} ${seed}`);
        const testDriver = await createTestDriver(
            driver,
            seed,
            undefined);
        console.log(`${args.testId} , ${testDriver} ,${driver}`);
        // Create a new file if a testId wasn't provided
        // const url = args.testId !== undefined
        //     ? await testDriver.createContainerUrl(args.testId)
        //     : await initialize(testDriver, seed);
        const url = await initialize(testDriver, seed);
        // const estRunningTimeMin = Math.floor(2 * profile.totalSendCount /
        // (profile.opRatePerMin * profile.numClients));
        // console.log(`Connecting to ${args.testId ? "existing" : "new"} with seed 0x${seed.toString(16)}`);
        console.log(`Container targeting with url:\n${url}`);
        config.tenants[profile.tenantArgs]?.docUrls.push(url);
    }
    const data = JSON.stringify(config);
    const name = `${profile.tenantArgs}_testConfigUser.json`;
    console.log(`${name}`);
    fs.writeFileSync(name, data);
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
    process.exit(0);
}

main().catch(
    (error) => {
        console.error(error);
        process.exit(-1);
    },
);
