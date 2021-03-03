/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import assert from "assert";
import fs from "fs";
import child_process from "child_process";
import commander from "commander";
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
import { getLoginPageUrl, getOdspScope, getDriveId, IOdspTokens } from "@fluidframework/odsp-doclib-utils";
import { pkgName, pkgVersion } from "./packageVersion";
import { ITestConfig, ILoadTestConfig, ITestTenant } from "./testConfigFile";
import { IRunConfig, fluidExport, ILoadTest } from "./loadTestDataStore";

const packageName = `${pkgName}@${pkgVersion}`;

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

async function initialize(driveId: string, loginInfo: IOdspTestLoginInfo) {
    const loader = createLoader(loginInfo);
    const container = await loader.createDetachedContainer(codeDetails);
    container.on("error", (error) => {
        console.log(error);
        process.exit(-1);
    });
    const siteUrl = `https://${loginInfo.server}`;
    const request = urlResolver.createCreateNewRequest(siteUrl, driveId, "/test", "test");
    await container.attach(request);
    const dataStoreUrl = await container.getAbsoluteUrl("/");
    assert(dataStoreUrl);

    container.close();

    return dataStoreUrl;
}

async function load(loginInfo: IOdspTestLoginInfo, url: string) {
    const loader = createLoader(loginInfo);
    const respond = await loader.request({ url });
    // TODO: Error checking
    return respond.value as ILoadTest;
}

async function main(this: any) {
    commander
        .version("0.0.1")
        .requiredOption("-t, --tenant <tenant>", "Which test tenant info to use from testConfig.json", "fluidCI")
        .requiredOption("-p, --profile <profile>", "Which test profile to use from testConfig.json", "ci")
        .option("-u, --url <url>", "Load an existing data store rather than creating new")
        .option("-r, --runId <runId>", "run a child process with the given id. Requires --url option.")
        .option("-d, --debug", "Debug child processes via --inspect-brk")
        .option("-l, --log <filter>", "Filter debug logging. If not provided, uses DEBUG env variable.")
        .option("-z, --numDoc <numDoc>", "If it is not provided then default value as 1 will be used.")
        .option("-ui, --userId <userId>", "If not provided by defaults it takes 0.")
        .option("-pid, --podId <podId>","If it is not provided then default value as 1 will be used.")
        .option("-npd, --numPod <numPod>","If it is not provided then default value as 1 will be used.")
        .parse(process.argv);
    const tenantArg: string = commander.tenant;
    const profileArg: string = commander.profile;
    const url: string | undefined = commander.url;
    const runId: number | undefined = commander.runId === undefined ? undefined : parseInt(commander.runId, 10);
    const debug: true | undefined = commander.debug;
    const log: string | undefined = commander.log;
    const numDoc: number | undefined = commander.numDoc === undefined ? 1 : parseInt(commander.numDoc, 10);
    const userId: number | undefined = commander.userId === undefined ? 0 : parseInt(commander.userId, 10);
    const podId: number | undefined = commander.podId === undefined ? 1 : parseInt(commander.podId, 10);
    const numPod: number | undefined = commander.numPod === undefined ? 1 : parseInt(commander.numPod, 10);
    let config: ITestConfig;
    try {
        config = JSON.parse(fs.readFileSync("./testConfigUser.json", "utf-8"));
    } catch (e) {
        console.error("Failed to read testConfigUser.json");
        console.error(e);
        process.exit(-1);
    }

    const tenant: ITestTenant | undefined = config.tenants[tenantArg];
    if (tenant === undefined) {
        console.error("Invalid --tenant argument not found in testConfig.json tenants");
        process.exit(-1);
    }
    const passwords: { [user: string]: string } =
        JSON.parse(process.env.login__odsp__test__accounts ?? "");
    const loginInfos: IOdspTestLoginInfo[] = [];
    for (let user = (podId - 1) * (tenant.usernames.length / numPod);
     user < podId * ((tenant.usernames.length / numPod)); user++) {
        let password: string;
        try {
            // Expected format of login__odsp__test__accounts is simply string key-value pairs of username and password
            password = passwords[tenant.usernames[user]];
            assert(password, "Expected to find Password in an env variable since it wasn't provided via script param");
        } catch (e) {
            console.error("Failed to parse login__odsp__test__accounts env variable");
            console.error(e);
            process.exit(-1);
        }
        // user_passwords.push(password);
        const loginInfo: IOdspTestLoginInfo = { server: tenant.server, username: tenant.usernames[user], password };
        loginInfos.push(loginInfo);
        // console.log(`${loginInfo.username} : ${loginInfo.password}`);
    }
    const profile: ILoadTestConfig | undefined = config.profiles[profileArg];
    if (profile === undefined) {
        console.error("Invalid --profile argument not found in testConfig.json profiles");
        process.exit(-1);
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
            process.exit(-1);
        }
        result = await runnerProcess(loginInfos[userId], profile, runId, url);
        process.exit(result);
    }
    // When runId is not specified, this is the orchestrator process which will spawn child test runners.
    result = await orchestratorProcess(loginInfos ,
        { ...profile, name: profileArg, tenetFriendlyName: tenantArg },
        { url, numDoc, debug});
    process.exit(result);
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
    try {
        const runConfig: IRunConfig = {
            runId,
            testConfig: profile,
        };
        const stressTest = await load(loginInfo, url);
        await stressTest.run(runConfig);
        console.log(`${runId.toString().padStart(3)}> exit`);
        return 0;
    } catch (e) {
        console.error(`${runId.toString().padStart(3)}> error: loading test`);
        console.error(e);
        return -1;
    }
}

/**
 * Implementation of the orchestrator process. Returns the return code to exit the process with.
 */
async function orchestratorProcess(
    loginInfos: IOdspTestLoginInfo[],
    profile: ILoadTestConfig & { name: string } & {tenetFriendlyName: string},
    args: { url?: string, numDoc?: number, debug?: true },
): Promise<number> {
    const currentdate = new Date();
    const startDatetime = `Last Sync: ${  currentdate.getDate().toString()  }/${
                 (currentdate.getMonth() + 1).toString()   }/${
                 currentdate.getFullYear().toString()  } @ ${
                 currentdate.getHours().toString()  }:${
                 currentdate.getMinutes().toString()  }:${
                 currentdate.getSeconds().toString()}`;
    const numDoc = args.numDoc === undefined ? 1 : args.numDoc;
    console.log("You are in orchestratorProcess");
    console.log(`------------${loginInfos.length}---------`);
    // const driveIds: string[] = [];
    // const docUrls: string[] = [];

    const p: Promise<void>[] = [];
    for (let docIndex = 0; docIndex < numDoc; docIndex++) {
        const ind = (docIndex % loginInfos.length);
        let odspTokens: IOdspTokens;
        try {
            // Ensure fresh tokens here so the test runners have them cached
            odspTokens = await odspTokenManager.getOdspTokens(
                loginInfos[ind].server,
                getMicrosoftConfiguration(),
                passwordTokenConfig(loginInfos[ind].username, loginInfos[ind].password),
                undefined /* forceRefresh */,
                true /* forceReauth */,
            );
            await odspTokenManager.getPushTokens(
                loginInfos[ind].server,
                getMicrosoftConfiguration(),
                passwordTokenConfig(loginInfos[ind].username, loginInfos[ind].password),
                undefined /* forceRefresh */,
                true /* forceReauth */,
            );
        } catch (ex) {
            // Log the login page url in case the caller needs to allow consent for this app
            const loginPageUrl =
                getLoginPageUrl(
                    loginInfos[ind].server,
                    getMicrosoftConfiguration(),
                    getOdspScope(loginInfos[ind].server),
                    "http://localhost:7000/auth/callback",
                );
            console.log("You may need to allow consent for this app. Re-run the tool after allowing consent.");
            console.log(`Go here allow the app: ${loginPageUrl}\n`);
            throw ex;
        }
        // console.log(`${odspTokens.accessToken}`);
        // Automatically determine driveId based on the server and user
        const driveId = await getDriveId(loginInfos[ind].server, "",
         undefined, { accessToken: odspTokens.accessToken });
        // Create a new file if a url wasn't provided
        const url = args.url ?? await initialize(driveId, loginInfos[ind]);
        // driveIds.push(driveId);
        // docUrls.push(url);
        // console.log(`driveId : ${driveId}  docUrl : ${url} loginInfos : ${loginInfos[0].server}` +
        // `${loginInfos[0].username} ${loginInfos[0].password}`);
        // console.log(`${loginInfos.length}`);
        for(let user = 0; user < loginInfos.length; user++) {
            let val = Math.floor(profile.numClients / loginInfos.length);
            if (profile.numClients % loginInfos.length > user) {
                val = val + 1;
            }
            // console.log(`value of val is ${val}`);
            if (val > 0) {
                console.log(`user auth within clients loop ${user} : ${loginInfos[user].username}`);
                const estRunningTimeMin = Math.floor(2 * profile.totalSendCount /
                     (profile.opRatePerMin * profile.numClients));
                console.log(`${docIndex + 1} ---> Connecting to ${args.url ? "existing" : "new"}` +
                `Container targeting dataStore with URL:\n${url}`);
                console.log(`Authenticated as user: ${loginInfos[user].username}`);
                console.log(`Selected test profile: ${profile.name}`);
                console.log(`Estimated run time: ${estRunningTimeMin} minutes\n`);
            }
            for (let i = 0; i < val; i++) {
                const childArgs: string[] = [
                    "./dist/nodeStressTest.js",
                    "--tenant", profile.tenetFriendlyName,
                    "--profile", profile.name,
                    "--runId", (user).toString(),
                    "--url", url,
                    "--userId", (user).toString()];
                if (args.debug) {
                    const debugPort = 9230 + user;
                    // 9229 is the default and will be used for the root orchestrator process
                    childArgs.unshift(`--inspect-brk=${debugPort}`);
                }
                const process = child_process.spawn(
                    "node",
                    childArgs,
                    { stdio: "inherit" },
                );
                p.push(new Promise((resolve) => process.on("close", resolve)));
            }
        }
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

    return 0;
}

main().catch(
    (error) => {
        console.error(error);
        process.exit(-1);
    },
);
