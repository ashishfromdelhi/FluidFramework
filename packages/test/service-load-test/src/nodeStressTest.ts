/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import assert from "assert";
import fs from "fs";
import child_process from "child_process";
import commander from "commander";
import * as applicationInsights from "applicationinsights";
import { Loader } from "@fluidframework/container-loader";
import { IFluidCodeDetails } from "@fluidframework/core-interfaces";
import {
    OdspDocumentServiceFactory,
    OdspDriverUrlResolver,
    OdspResourceTokenFetchOptions,
} from "@fluidframework/odsp-driver";
import { LocalCodeLoader } from "@fluidframework/test-utils";
import {
    OdspTokenManager,
    odspTokensCache,
    getMicrosoftConfiguration,
    OdspTokenConfig,
} from "@fluidframework/tool-utils";

import { getLoginPageUrl, getOdspScope } from "@fluidframework/odsp-doclib-utils";
import { pkgName, pkgVersion } from "./packageVersion";
import { ITestConfig, ILoadTestConfig, ITestTenant } from "./testConfigFile";
import { IRunConfig, fluidExport, ILoadTest } from "./loadTestDataStore";

const packageName = `${pkgName}@${pkgVersion}`;

enum EXIT_ERROR {
    SUCCESS = 0,
    UNKNOWN = -1,

    FAILED_TO_READ_TESTCONFIGUSER = -11,
    INVALID_TENANT = -12,
    FAILED_TO_PARSE_LOGIN_ENV = -13,
    INVALID_PROFILE = -14,
    MISSING_URL = -15,

    CLIENT_ERROR = -21,
}

interface IOdspTestLoginInfo {
    server: string;
    username: string;
    password: string;
}

const codeDetails: IFluidCodeDetails = {
    package: packageName,
    config: {},
};

const codeLoader = new LocalCodeLoader([[codeDetails, fluidExport]]);
const urlResolver = new OdspDriverUrlResolver();
const odspTokenManager = new OdspTokenManager(odspTokensCache);

const passwordTokenConfig = (username, password): OdspTokenConfig => ({
    type: "password",
    username,
    password,
});

let telemetryClient: applicationInsights.TelemetryClient;

function createLoader(loginInfo: IOdspTestLoginInfo) {
    const documentServiceFactory = new OdspDocumentServiceFactory(
        async (options: OdspResourceTokenFetchOptions) => {
            const tokens = await odspTokenManager.getOdspTokens(
                loginInfo.server,
                getMicrosoftConfiguration(),
                passwordTokenConfig(loginInfo.username, loginInfo.password),
                options.refresh,
            );
            return tokens.accessToken;
        },
        async (options: OdspResourceTokenFetchOptions) => {
            const tokens = await odspTokenManager.getPushTokens(
                loginInfo.server,
                getMicrosoftConfiguration(),
                passwordTokenConfig(loginInfo.username, loginInfo.password),
                options.refresh,
            );
            return tokens.accessToken;
        },
    );

    // Construct the loader
    const loader = new Loader({
        urlResolver,
        documentServiceFactory,
        codeLoader,
    });
    return loader;
}

async function load(loginInfo: IOdspTestLoginInfo, url: string) {
    const loader = createLoader(loginInfo);
    const respond = await loader.request({ url });
    // TODO: Error checking
    return respond.value as ILoadTest;
}

async function main(this: any) {
    applicationInsights.setup().start();
    telemetryClient = applicationInsights.defaultClient;

    commander
        .version("0.0.1")
        .requiredOption("-t, --tenant <tenant>", "Which test tenant info to use from testConfig.json", "fluidCI")
        .requiredOption("-p, --profile <profile>", "Which test profile to use from testConfig.json", "ci")
        .option("-u, --url <url>", "Load an existing data store rather than creating new")
        .option("-r, --runId <runId>", "run a child process with the given id. Requires --url option.")
        .option("-d, --debug", "Debug child processes via --inspect-brk")
        .option("-l, --log <filter>", "Filter debug logging. If not provided, uses DEBUG env variable.")
        .option("-z, --numDoc <numDoc>", "If it is not provided then default value as 1 will be used.")
        .option("-pid, --podId <podId>","If it is not provided then default value as 1 will be used.")
        .parse(process.argv);
    const tenantArg: string = commander.tenant;
    const profileArg: string = commander.profile;
    const url: string | undefined = commander.url;
    const runId: number | undefined = commander.runId === undefined ? undefined : parseInt(commander.runId, 10);
    const debug: true | undefined = commander.debug;
    const log: string | undefined = commander.log;
    const numDoc: number | undefined = commander.numDoc === undefined ? 1 : parseInt(commander.numDoc, 10);
    const podId: number | undefined = commander.podId === undefined ? 1 : parseInt(commander.podId, 10);
    let config: ITestConfig;
    try {
        config = JSON.parse(fs.readFileSync("./testConfigUser.json", "utf-8"));
    } catch (e) {
        console.error("Failed to read testConfigUser.json");
        console.error(e);
        process.exitCode = EXIT_ERROR.FAILED_TO_READ_TESTCONFIGUSER;
        return;
    }

    const tenant: ITestTenant | undefined = config.tenants[tenantArg];
    if (tenant === undefined) {
        console.error("Invalid --tenant argument not found in testConfig.json tenants");
        process.exitCode = EXIT_ERROR.INVALID_TENANT;
        return;
    }
    const passwords: { [user: string]: string } =
        JSON.parse(process.env.login__odsp__test__accounts ?? "");
    const user = podId % tenant.usernames.length;
    let password: string;
        try {
            // Expected format of login__odsp__test__accounts is simply string key-value pairs of username and password
            password = passwords[tenant.usernames[user]];
            assert(password, "Expected to find Password in an env variable since it wasn't provided via script param");
        } catch (e) {
            console.error("Failed to parse login__odsp__test__accounts env variable");
            console.error(e);
            process.exitCode = EXIT_ERROR.FAILED_TO_PARSE_LOGIN_ENV;
            return;
        }
    // user_passwords.push(password);
    const loginInfo: IOdspTestLoginInfo = { server: tenant.server, username: tenant.usernames[user], password };
    // console.log(`${loginInfo.username} : ${loginInfo.password}`);
    const urlList = tenant.docUrls;
    // console.log(`==========${urlList.length} *****`);
    const profile: ILoadTestConfig | undefined = config.profiles[profileArg];
    if (profile === undefined) {
        console.error("Invalid --profile argument not found in testConfig.json profiles");
        process.exitCode = EXIT_ERROR.INVALID_PROFILE;
        return;
    }

    if (log !== undefined) {
        process.env.DEBUG = log;
    }
    // console.log(`------------------  ${loginInfos.length} ------------`);
    // for (const loginInfo of loginInfos) {
    //     console.log(`${loginInfo.server} , ${loginInfo.username} , ${loginInfo.password}`);
    // }
    let result: number;
    // When runId is specified (with url), kick off a single test runner and exit when it's finished
    if (runId !== undefined) {
        if (url === undefined) {
            console.error("Missing --url argument needed to run child process");
            process.exitCode = EXIT_ERROR.MISSING_URL;
            return;
        }
        // console.log(`${runId}`);
        result = await runnerProcess(loginInfo, profile, runId, url);
    } else {
        // When runId is not specified, this is the orchestrator process which will spawn child test runners.
        result = await orchestratorProcess(loginInfo ,
            { ...profile, name: profileArg, tenetFriendlyName: tenantArg },
            { urlList, numDoc, podId, debug});
    }

    process.exitCode = result;
}

/**
 * Implementation of the runner process. Returns the return code to exit the process with.
 */
async function runnerProcess(
    loginInfo: IOdspTestLoginInfo,
    profile: ILoadTestConfig,
    runId: number,
    url: string,
): Promise<number> {
    telemetryClient.trackMetric({name: "Test Client Started", value: 1});
    telemetryClient.trackTrace({message: `${runId}> Starting test client with url: ${url}`});

    try {
        const runConfig: IRunConfig = {
            runId,
            testConfig: profile,
        };
        const stressTest = await load(loginInfo, url);

        await stressTest.run(runConfig);
        console.log(`${runId.toString().padStart(3)}> exit`);

        telemetryClient.trackMetric({name: "Test Client Successful", value: 1});
        telemetryClient.trackTrace({message: `${runId}> Completed test client with url: ${url}`});

        return EXIT_ERROR.SUCCESS;
    } catch (e) {
        console.error(`${runId.toString().padStart(3)}> error: loading test`);
        console.error(e);

        telemetryClient.trackMetric({name: "Test Client Error", value: 1});
        telemetryClient.trackTrace({message: `${runId}> Error in test client url: ${url} Error: ${e}`});
        telemetryClient.trackException({exception: e});

        return EXIT_ERROR.CLIENT_ERROR;
    }
}

/**
 * Implementation of the orchestrator process. Returns the return code to exit the process with.
 */
async function orchestratorProcess(
    loginInfo: IOdspTestLoginInfo,
    profile: ILoadTestConfig & { name: string } & {tenetFriendlyName: string},
    args: { urlList?: string[], numDoc?: number, podId?: number, debug?: true },
): Promise<number> {
    const currentdate = new Date();
    const startDatetime = `Last Sync: ${  currentdate.getDate().toString()  }/${
                 (currentdate.getMonth() + 1).toString()   }/${
                 currentdate.getFullYear().toString()  } @ ${
                 currentdate.getHours().toString()  }:${
                 currentdate.getMinutes().toString()  }:${
                 currentdate.getSeconds().toString()}`;
    const numDoc = args.numDoc === undefined ? 1 : args.numDoc;
    const podId = args.podId === undefined ? 1 : args.podId;
    console.log(`You are in orchestratorProcess ${numDoc}`);

    telemetryClient.trackTrace({message: `Starting Orchestrator Process. Docs count: ${numDoc}`});

    // const driveIds: string[] = [];
    // const docUrls: string[] = [];
    // let odspTokens: IOdspTokens;
    try {
        // Ensure fresh tokens here so the test runners have them cached
        await odspTokenManager.getOdspTokens(
            loginInfo.server,
            getMicrosoftConfiguration(),
            passwordTokenConfig(loginInfo.username, loginInfo.password),
            undefined /* forceRefresh */,
            true /* forceReauth */,
        );
        await odspTokenManager.getPushTokens(
            loginInfo.server,
            getMicrosoftConfiguration(),
            passwordTokenConfig(loginInfo.username, loginInfo.password),
            undefined /* forceRefresh */,
            true /* forceReauth */,
        );
    } catch (ex) {
    // Log the login page url in case the caller needs to allow consent for this app
    const loginPageUrl = getLoginPageUrl(
            loginInfo.server,
            getMicrosoftConfiguration(),
            getOdspScope(loginInfo.server),
            "http://localhost:7000/auth/callback",
        );
        console.log("You may need to allow consent for this app. Re-run the tool after allowing consent.");
        console.log(`Go here allow the app: ${loginPageUrl}\n`);
        throw ex;
    }
    // console.log(`${odspTokens.accessToken}  ************   ${args.urlList?.length}  ************`);
    const p: Promise<void>[] = [];
    let cnt = 0;
    let offset = Math.floor((podId - 1) / 10) * numDoc;
    offset = args.urlList === undefined ? 0 : (offset % args.urlList.length);
    const leftIndex = offset;
    const rightIndex = offset + numDoc;
    const urls: string[] | undefined = args.urlList?.slice(leftIndex, rightIndex);
    let randomOrderUrls: string[] = [];
    if (urls !== undefined) {
        randomOrderUrls = urls.sort((a, b) => 0.5 - Math.random());
    }
    for (let docIndex = 0; docIndex < numDoc; docIndex++) {
        const url = args.urlList === undefined ? "NoUrl" : randomOrderUrls[docIndex];
        // console.log(`user auth within clients loop  : ${loginInfo.username}`);
        const estRunningTimeMin = Math.floor(2 * profile.totalSendCount /
         (profile.opRatePerMin * profile.numClients));
        // console.log(`Authenticated as user: ${loginInfo.username}`);
        // console.log(`Selected test profile: ${profile.name}`);
        console.log(`Estimated run time: ${estRunningTimeMin} minutes\n`);
        console.log(` ${url}  ^^^^^^^^^^^^^^^ ${loginInfo.username}`);
        const childArgs: string[] = [
            "./dist/nodeStressTest.js",
            "--tenant", profile.tenetFriendlyName,
            "--profile", profile.name,
            "--runId", (cnt).toString(),
            "--url", url];
        if (args.debug) {
            const debugPort = 9230 + docIndex;
            // 9229 is the default and will be used for the root orchestrator process
            childArgs.unshift(`--inspect-brk=${debugPort}`);
        }

        try {
            const process = child_process.spawn(
                "node",
                childArgs,
                { stdio: "inherit" },
            );

            process.on("exit", (code, signal) => {
                telemetryClient.trackTrace({
                    message: `Test Client exited. Code: ${code} Signal: ${signal} Url: ${url}`,
                });
            });
            process.on("error", (err) => {
                console.error("Error in child process.");
                console.error(err);

                telemetryClient.trackTrace({ message: `Test Client exited with error. Url: ${url} Error: ${err}` });
            });

            telemetryClient.trackTrace({ message: `Started test client process. Url: ${url}` });
            p.push(new Promise((resolve) => process.on("close", resolve)));
        } catch (e) {
            console.error("Error in starting child process.");
            console.error(e);

            telemetryClient.trackTrace({ message: `Error in starting test client. Url: ${url}` });
            telemetryClient.trackException({ exception: e });
        }

        cnt = (cnt + 1) % 10;
    }
    await Promise.all(p);
    const currentdate_end = new Date();
    const endDatetime = `Last Sync: ${  currentdate_end.getDate().toString()  }/${
                 (currentdate_end.getMonth() + 1).toString()  }/${
                 currentdate_end.getFullYear().toString()  } @ ${
                 currentdate_end.getHours().toString()  }:${
                 currentdate_end.getMinutes().toString()  }:${
                 currentdate_end.getSeconds().toString()}`;
    console.log(`Start Time : ${startDatetime}`);
    console.log(`End Time : ${endDatetime}`);

    return EXIT_ERROR.SUCCESS;
}

main().catch(
    (error) => {
        console.error(error);
        telemetryClient.trackException({exception: error});
        process.exitCode = EXIT_ERROR.UNKNOWN;
    },
).finally(() => {
    telemetryClient.flush();
    applicationInsights.dispose();
});
