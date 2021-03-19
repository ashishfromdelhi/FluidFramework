/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import assert from "assert";
import fs from "fs";
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
import { ITestConfig, ITestTenant } from "./testConfigFile";
import { fluidExport } from "./loadTestDataStore";
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

async function main(this: any) {
    commander
        .version("0.0.1")
        .requiredOption("-t, --tenant <tenant>", "Which test tenant info to use from testConfig.json", "fluidCI")
        .requiredOption("-z, --numDoc <numDoc>", "If it is not provided then default value as 1 will be used.")
        .parse(process.argv);
    const tenantArg: string = commander.tenant;
    const numDoc: number | undefined = commander.numDoc === undefined ? 1 : parseInt(commander.numDoc, 10);
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
    const totalUsers = tenant.usernames.length;
    // const urls: string[] = [];
    for (let user = 0; user < totalUsers; user++) {
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
    }
    const urlsLen = config.tenants[tenantArg]?.docUrls.length;
    config.tenants[tenantArg]?.docUrls.splice(0,urlsLen);
    for (let user = 0; user < totalUsers; user++) {
        let odspTokens: IOdspTokens;
        try {
            // Ensure fresh tokens here so the test runners have them cached
            odspTokens = await odspTokenManager.getOdspTokens(
                loginInfos[user].server,
                getMicrosoftConfiguration(),
                passwordTokenConfig(loginInfos[user].username, loginInfos[user].password),
                undefined /* forceRefresh */,
                true /* forceReauth */,
            );
        } catch (ex) {
            // Log the login page url in case the caller needs to allow consent for this app
            const loginPageUrl =
                getLoginPageUrl(
                    loginInfos[user].server,
                    getMicrosoftConfiguration(),
                    getOdspScope(loginInfos[user].server),
                    "http://localhost:7000/auth/callback",
                );
            console.log("You may need to allow consent for this app. Re-run the tool after allowing consent.");
            console.log(`Go here allow the app: ${loginPageUrl}\n`);
            throw ex;
        }
        let val = Math.floor(numDoc / loginInfos.length);
        if(user < numDoc % loginInfos.length) {
            val++;
        }
        for (let docIndex = 0; docIndex < val; docIndex++) {
            const ind = (docIndex % loginInfos.length);
            const driveId = await getDriveId(loginInfos[ind].server, "",
             undefined, { accessToken: odspTokens.accessToken });
            const url = await initialize(driveId, loginInfos[user]);
            console.log(`${url}`);
            config.tenants[tenantArg]?.docUrls.push(url);
        }
    }
    console.log(`${config.tenants[tenantArg]?.docUrls.length}`);
    const data = JSON.stringify(config);
    fs.writeFileSync("testConfigUser.json", data);
    process.exit(0);
}
main().catch(
    (error) => {
        console.error(error);
        process.exit(-1);
    },
);
