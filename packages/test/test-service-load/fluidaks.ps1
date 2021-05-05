function RunLoadTest {
    [CmdletBinding()]
    Param(
        [Parameter(Mandatory = $false)]
        [int]$NumOfDocs = 1,
        [Parameter(Mandatory = $false)]
        [string]$Profile = 'BaseScenario_2.5',
        [Parameter(Mandatory = $false)]
        [string]$Namespace = 'odsp-perf-lg-fluid'
    )
    if ( ( $NumOfDocs -gt 10 ) -and ( $Namespace -ne 'odsp-perf-lg-fluid' ) ) {
        Write-Host "Large tests should be run with namespace odsp-perf-lg-fluid. Exiting."
        return
    }
    $Profiles = Get-Content -Raw -Path .\testConfig.json | ConvertFrom-Json
    [int]$NumOfUsersPerDoc = $Profiles.profiles.$Profile.numClients
    Write-Host "Starting RunLoadTest NumOfDocs: $NumOfDocs, Profile: $Profile, NumOfUsersPerDoc: $NumOfUsersPerDoc"
    kubectl config set-context --current --namespace=$Namespace | out-null
    CreateInfra -NumOfPods $NumOfDocs -Namespace $Namespace
    RunTest -Profile $Profile -Namespace $Namespace -NumOfUsersPerDoc $NumOfUsersPerDoc -NumOfDocs $NumOfDocs
}
function CreateInfra{
    [CmdletBinding()]
    Param(
        [Parameter(Mandatory = $true)]
        [int]$NumOfPods,
        [Parameter(Mandatory = $true)]
        [string]$Namespace
    )
    kubectl create namespace $Namespace
    kubectl apply -f load-generator-fluid-app.yaml -n $Namespace
    kubectl scale deployments lg-fluidapp -n $Namespace --replicas=$NumOfPods
    $RunningNumOfPods = $(kubectl get pods -n $Namespace --field-selector status.phase=Running).count -1
    while ($NumOfPods -ne $RunningNumOfPods) {
        Write-Host "Pods are in-progress"
        Start-Sleep -s 10
        $RunningNumOfPods = $(kubectl get pods -n $Namespace  --field-selector status.phase=Running).count -1
    }
    Write-Host "Pods are created and running"
}
workflow RunTest{
    [CmdletBinding()]
    Param(
        [Parameter(Mandatory = $true)]
        [string]$Profile,
        [Parameter(Mandatory = $true)]
        [string]$Namespace,
        [Parameter(Mandatory = $true)]
        [int]$NumOfUsersPerDoc,
        [Parameter(Mandatory = $true)]
        [int]$NumOfDocs
    )
    $Tenants = (Get-Content -Raw -Path testTenantConfig.json | ConvertFrom-Json).tenants
    $TenantsCount = ($Tenants | Get-Member -MemberType NoteProperty).Count
    $Pods = $(kubectl get pods -n $Namespace --field-selector status.phase=Running -o json | ConvertFrom-Json).items
    $TestUid = [guid]::NewGuid()
    [int]$PodsCount = $Pods.count
    if ( $PodsCount -ne $NumOfDocs ) {
        Write-Error "Number of pods not equal to number of docs"
        return
    }
    Write-Output "Load Starting ${testUid}"
    $Started = 0
    foreach -parallel -ThrottleLimit 10 ($i in 1..$PodsCount) {
        $SleepTime = Get-Random -Minimum 15 -Maximum 30
        sleep $SleepTime
        $PodName = $Pods[$i - 1].metadata.name
        $TenantIndex = ($i-1) % $TenantsCount
        $TenantName = ($Tenants | Get-Member -MemberType NoteProperty)[$TenantIndex].Name
        $ConfigFileName = $PodName + ".json"
        $TenantContent = $Tenants.$TenantName
        $RemoteFile = "$Namespace/${PodName}:/app/packages/test/test-service-load/testUserConfig.json"
        InlineScript {
            cd $env:TEMP
            $using:TenantContent | ConvertTo-Json | Out-File -Encoding ascii -FilePath $using:ConfigFileName
            kubectl cp $using:ConfigFileName $using:RemoteFile
        }

        $Command = "FLUID_TEST_UID='$TestUid' node ./dist/nodeStressTestMultiUser.js -p $Profile -pod $PodName > testscenario.logs 2>&1 &"
        Write-Output "Exec Command: $Command on Pod: $PodName"
        kubectl exec $PodName -n $Namespace -- bash -c $Command
        kubectl exec $PodName -n $Namespace -- bash -c "ps -aux | grep node | grep -v grep"
        if ($LastExitCode) {
            Write-Error "Error in starting process on pod ${PodName}. Trying once more."
            kubectl exec $PodName -n $Namespace -- bash -c $Command
            kubectl exec $PodName -n $Namespace -- bash -c "ps -aux | grep node | grep -v grep"
            if ($LastExitCode) {
                Write-Error "Error in starting process on pod ${PodName}. Retry failed. Exiting"
                Exit 1
            }
        }
        $workflow:Started++
        Write-Output "Exec Command DONE: on Pod: $PodName"
    }
    Write-Output "Load Submitted. Started ${Started} pods. TestUid: ${TestUid}"
}