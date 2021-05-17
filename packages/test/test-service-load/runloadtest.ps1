function RunLoadTest {

    [CmdletBinding()]
    Param(
        [Parameter(Mandatory = $false)]
        [int]$NumOfDocs = 1,
		[Parameter(Mandatory = $false)]
        [string]$Profile = 'BaseScenario_2.5',
		[Parameter(Mandatory = $false)]
        [string]$Namespace = 'odsp-perf-lg-fluid',
        [Parameter(Mandatory = $false)]
        [string]$TestUid = [guid]::NewGuid()
    )

    if ( ( $NumOfDocs -gt 10 ) -and ( $Namespace -ne 'odsp-perf-lg-fluid' ) ) {
        Write-Host "Large tests should be run with namespace odsp-perf-lg-fluid. Exiting."
        return
    }

    Write-Output "Running TestUid: $TestUid"

    $Profiles = Get-Content -Raw -Path .\testConfig.json | ConvertFrom-Json
    [int]$NumOfUsersPerDoc = $Profiles.profiles.$Profile.numClients
    Write-Host "Starting RunLoadTest NumOfDocs: $NumOfDocs, Profile: $Profile, NumOfUsersPerDoc: $NumOfUsersPerDoc"
	kubectl config set-context --current --namespace=$Namespace | out-null
	CreateInfra -NumOfPods $NumOfDocs -Namespace $Namespace
	RunTest -Profile $Profile -Namespace $Namespace -NumOfUsersPerDoc $NumOfUsersPerDoc -NumOfDocs $NumOfDocs -TestUid $TestUid
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
    $RunningNumOfPods = $(kubectl get pods -n $Namespace --field-selector status.phase=Running).count - 1
    while ($NumOfPods -ne $RunningNumOfPods) {
        Write-Host "Pods are in-progress"
        Start-Sleep -s 10
        $RunningNumOfPods = $(kubectl get pods -n $Namespace  --field-selector status.phase=Running).count - 1
    }
    Write-Host "Pods are created and running"
}

function RunTest{
	[CmdletBinding()]
    Param(
		[Parameter(Mandatory = $true)]
        [string]$Profile,
		[Parameter(Mandatory = $true)]
        [string]$Namespace,
        [Parameter(Mandatory = $true)]
        [int]$NumOfUsersPerDoc,
        [Parameter(Mandatory = $true)]
        [int]$NumOfDocs,
        [Parameter(Mandatory = $true)]
        [string]$TestUid
    )

    $Tenants = (Get-Content -Raw -Path testTenantConfig.json | ConvertFrom-Json).tenants
    $TenantNames = $Tenants | Get-Member -MemberType NoteProperty | Select -ExpandProperty Name
    $TenantsCount = $TenantNames.Count
	$Pods = $(kubectl get pods -n $Namespace --field-selector status.phase=Running -o json | ConvertFrom-Json).items
    [int]$PodsCount = $Pods.count

    if ( $PodsCount -ne $NumOfDocs ) {
        Write-Error "Number of pods not equal to number of docs"
        return
     }

    Write-Output "Load Starting ${testUid}"

    $Configs = @{}
    $TempPath = $env:TEMP
    $Index = 0
    foreach ($Tenant in $TenantNames) {
        $ConfigFileName = (Join-Path -Path $TempPath -ChildPath ($Tenant + ".json"))
        $TenantContent = $Tenants.$Tenant
        $TenantContent | ConvertTo-Json | Out-File -Encoding ascii -FilePath $ConfigFileName
        $Configs.Add($Index, $ConfigFileName)
        $Index++
    }

    foreach ($i in 1..$PodsCount) {
        $SleepTime = Get-Random -Minimum 0 -Maximum 3
        sleep $SleepTime

        $PodName = $Pods[$i - 1].metadata.name
        $TenantIndex = ($i-1) % $TenantsCount
        $RemoteFile = "$Namespace/${PodName}:/app/packages/test/test-service-load/testUserConfig.json"

        Write-Output "Copying config file to $PodName"
        kubectl cp $Configs[$TenantIndex] $RemoteFile

        $Command = "FLUID_TEST_UID='$TestUid' node ./dist/nodeStressTestMultiUser.js -p $Profile > testscenario.logs 2>&1 &"

        Write-Output "Exec Command: $Command on Pod: $PodName"
        kubectl exec $PodName -n $Namespace -- bash -c $Command
        Write-Output "Exec Command DONE: on Pod: $PodName"

        Write-Output "Completed $i"
        Write-Output ""
    }

	Write-Output "Load Submitted. Started ${Started} pods. TestUid: ${TestUid}"
}

function CheckTest{
	[CmdletBinding()]
    Param(
		[Parameter(Mandatory = $true)]
        [string]$Namespace
    )

	$Pods = $(kubectl get pods -n $Namespace --field-selector status.phase=Running -o json | ConvertFrom-Json).items
    [int]$PodsCount = $Pods.count

    Write-Output "Checking test"

    foreach ($i in 1..$PodsCount) {
        $PodName = $Pods[$i - 1].metadata.name
        $Command = "ps -a | grep node"

        Write-Output "$PodName starting"
        kubectl exec $PodName -n $Namespace -- bash -c $Command
        if ($? -eq $false) {
            Exit 1
        }
        Write-Output "$PodName starting"
    }
}
