// import child_process from "child_process";
import fs from "fs";
import { ITestConfig, ITestTenant } from "./testConfigFile";

async function main() {
    const currentdate = new Date();
    const startDatetime = `Last Sync: `
        + `${currentdate.getDate().toString()}`
        + `/${(currentdate.getMonth() + 1).toString()}`
        + `/${currentdate.getFullYear().toString()}`
        + ` @ ${currentdate.getHours().toString()}`
        + `:${currentdate.getMinutes().toString()}`
        + `:${currentdate.getSeconds().toString()}`;
    let config: ITestConfig;
    try {
        config = JSON.parse(fs.readFileSync("./testConfigUser.json", "utf-8"));
    } catch (e) {
        console.error("Failed to read testConfigUser.json");
        console.error(e);
        // process.exitCode = EXIT_ERROR.FAILED_TO_READ_TESTCONFIGUSER;
        return;
    }
    const tenants: string[] = ["0001","0002","0220","0312","0420","0500","0900","0920","1400","1520","21220"];
    for (const tenant_ind of tenants)  {
        const _name = `${tenant_ind}_testConfigUser.json`;
        // Removing old docs from testConfig.json for tenant_ind
        const urlsLen = config.tenants[tenant_ind]?.docUrls.length;
        config.tenants[tenant_ind]?.docUrls.splice(0,urlsLen);
        // Adding docs from ${tenant_ind}testConfig.json to testConfig.json
        let _config: ITestConfig;
        try {
            _config = JSON.parse(fs.readFileSync(_name, "utf-8"));
        } catch (e) {
            console.error(`Failed to read ${_name}`);
            console.error(e);
            // process.exitCode = EXIT_ERROR.FAILED_TO_READ_TESTCONFIGUSER;
            return;
        }
        const tenant: ITestTenant | undefined = _config.tenants[tenant_ind];
        // console.log(`${tenant}`);
        if (tenant !== undefined) {
            for (const url of tenant.docUrls) {
                config.tenants[tenant_ind]?.docUrls.push(url);
            }
            console.log(`${_name} completed and ${config.tenants[tenant_ind]?.docUrls.length}`);
        }
    }
    const data = JSON.stringify(config);
    fs.writeFileSync("testConfigUser_final.json", data);
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
    console.log(`Test Completed`);
    process.exit(0);
}
/**
 * Implementation of the orchestrator process. Returns the return code to exit the process with.
 */
main().catch(
    (error) => {
        console.error(error);
        process.exit(-1);
    },
);
