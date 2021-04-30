function RunLoadTest {

    [CmdletBinding()]
    Param(
        [Parameter(Mandatory = $true)]
        [int]$NumOfPods,
		[Parameter(Mandatory = $true)]
        [int]$NumOfDocsPerPod,
		[Parameter(Mandatory = $true)]
        [string]$Profile,
        [Parameter(Mandatory = $false)]
        [int]$NumOfUsersPerDoc = 10,
		[Parameter(Mandatory = $false)]
        [string]$Namespace = 'odsp-perf-lg-fluid'
    )

    if ( ( $NumOfPods -gt 100 ) -and ( $Namespace -ne 'odsp-perf-lg-fluid' ) ) {
        Write-Host "Large tests should be run with namespace odsp-perf-lg-fluid. Exiting."
        return
    }

    Write-Host "Starting RunLoadTest NumOfPods: $NumOfPods, NumOfDocsPerPod: $NumOfDocsPerPod, Profile: $Profile"
	kubectl config set-context --current --namespace=$Namespace | out-null
	CreateInfra -NumOfPods $NumOfPods -Namespace $Namespace
	#GenerateConfig -PodName $PodName -NumOfDocsPerTenant 2
	#DownloadConfig -PodName $PodName
	#UploadConfig
	RunTest -NumOfDocsPerPod $NumOfDocsPerPod -Profile $Profile -Namespace $Namespace -NumOfUsersPerDoc $NumOfUsersPerDoc -NumOfPods $NumOfPods
}

function CreateDoc{
    [CmdletBinding()]
    Param(
        [Parameter(Mandatory = $true)]
        [int]$NumOfPods,
		[Parameter(Mandatory = $true)]
        [string]$Namespace
    )
    $Tenants = @('21220','1520','0900','0001','0002','0312','0420','0500','0920','0220')
	$Pods = $(kubectl get pods -n $Namespace --field-selector status.phase=Running -o json | ConvertFrom-Json).items
    [int]$PodsCount = $Pods.count
    [int]$numDoc = [int][Math]::Floor( ($NumOfPods + $Tenants.count - 1 ) / $Tenants.count ) * 30
    Write-Host "  ----> $numDoc  "
    foreach ($i in 1..$Tenants.count) {
        $PodName = $Pods[$i - 1].metadata.name
		#$TenantIndex = ($i-1) % $Tenants.count
		$TenantIdentifier = $Tenants[$i - 1]
		#$PodId=[int][Math]::Floor(($i + $Tenants.count -1)/$Tenants.count)
        $Command = "node ./dist/createDocument.js --tenant $TenantIdentifier --numDoc $numDoc > docCreation.logs 2>&1 &"
        Write-Output "Exec Command: $Command on Pod: $PodName"
		kubectl exec $PodName -n $Namespace -- bash -c $Command
        Write-Output "Exec Command DONE: on Pod: $PodName"
    }

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
        [int]$NumOfDocsPerPod,
        [Parameter(Mandatory = $true)]
        [int]$NumOfPods,
        [Parameter(Mandatory = $true)]
        [int]$NumOfUsersPerDoc,
		[Parameter(Mandatory = $true)]
        [string]$Profile,
		[Parameter(Mandatory = $true)]
        [string]$Namespace
    )
	$Tenants = @('21220','1520','0900','0001','0002','0312','0420','0500','0920','0220')[0..($NumOfPods/$NumOfUsersPerDoc - 1)]
	$Pods = $(kubectl get pods -n $Namespace --field-selector status.phase=Running -o json | ConvertFrom-Json).items
    $testUid = [guid]::NewGuid()
    [int]$PodsCount = $Pods.count
    Write-Output "Load Starting ${testUid}"
    $loginDetails = Get-Content -Path ".\loginOdspTestAccounts.json" | ConvertFrom-JSON
    $Tenant_detail = Get-Content -Path ".\tenantMap.json" | ConvertFrom-JSON
    #Write-Host "$Tenant_detail.$"
    #foreach -parallel -ThrottleLimit 1 ($i in 1..$PodsCount) {
    foreach ($i in 1..$PodsCount) {
		$PodName = $Pods[$i - 1].metadata.name
		$TenantIndex = ($i-1) % $Tenants.count
		$TenantIdentifier = $Tenants[$TenantIndex]
		$PodId=[int][Math]::Floor(($i + $Tenants.count -1)/$Tenants.count)
        $temp = $Tenant_detail.$TenantIdentifier
        $user = "user$PodId@$temp"
        $password = $loginDetails.$user
        $Command1 = "export login__odsp__test__accounts='{" + $user + ": " + $password + "}'"
        Write-Output "$command1"
        $Command2 = "node ./dist/nodeStressTest.js --profile $Profile --instrumentationKey '8bdf0a93-fb15-4193-b68e-c0582087a341' > testscenario.logs 2>&1 &"
        #$Command2 = "node ./dist/nodeStressTest.js --tenant $TenantIdentifier --profile $Profile --numDoc $NumOfDocsPerPod --numUsersPerDoc $NumOfUsersPerDoc --podId $PodId --testUid $testUid --instrumentationKey '8bdf0a93-fb15-4193-b68e-c0582087a341' > testscenario.logs 2>&1 &"
        $Command = "$Command1 && $Command2"
        Write-Output "$Command"
        Write-Output "Exec Command: $Command on Pod: $PodName"
		kubectl exec $PodName -n $Namespace -- bash -c $Command
        #kubectl exec $PodName -n $Namespace -- bash -c $Command2
        Write-Output "Exec Command DONE: on Pod: $PodName \n"
    }
	Write-Output "Load Submitted"
	#kubectl delete namespace odsp-perf-lg-fluid
}

function DownloadLogs {
	[CmdletBinding()]
    Param(
		[Parameter(Mandatory = $true)]
        [string]$Namespace
    )
	Write-Host "DownloadLogs started"
	kubectl config set-context --current --namespace $Namespace | out-null
	$Pods = $(kubectl get pods -n $Namespace --field-selector status.phase=Running -o json | ConvertFrom-Json).items
    [int]$PodsCount = $Pods.count
	$foldername = [guid]::NewGuid()
	New-Item -Path $foldername -ItemType Directory | out-null
	Write-Host "A new directory is created: $foldername"
	Write-Host "Logs will be downloaded in this new directory: $foldername"
    foreach ($i in 1..$PodsCount)  {
		$PodName = $Pods[$i - 1].metadata.name
        Write-Host "Started downloading logs for Pod: $PodName"
		kubectl cp $PodName`:/app/testscenario.logs $foldername/$PodName.logs  | out-null
		Write-Host "Completed downloading logs for Pod: $PodName"
    }
	Write-Host "DownloadLogs finished"
	return $foldername
}

function UploadConfig {
	Write-Host "UploadConfig started"
	kubectl config set-context --current --namespace=odsp-perf-lg-fluid | out-null
	$Pods = $(kubectl get pods -n odsp-perf-lg-fluid --field-selector status.phase=Running -o json | ConvertFrom-Json).items
    [int]$PodsCount = $Pods.count
	foreach ($i in 1..$PodsCount) {
		$PodName = $Pods[$i - 1].metadata.name
        Write-Host "Started UploadConfig on Pod: $PodName"
		kubectl cp testConfigUser.json $PodName`:/app/
		Write-Host "Completed uploadConfig on Pod: $PodName"
    }
	Write-Host "UploadConfig finished"
}

function DownloadConfig {
	Write-Host "DownloadConfig started"
	kubectl config set-context --current --namespace=odsp-perf-lg-fluid | out-null
	$Pods = $(kubectl get pods -n odsp-perf-lg-fluid --field-selector status.phase=Running -o json | ConvertFrom-Json).items
    [int]$PodsCount = $Pods.count
	$foldername = [guid]::NewGuid()
	New-Item -Path $foldername -ItemType Directory | out-null
	Write-Host "A new directory is created: $foldername"
	Write-Host "Config will be downloaded in this new directory: $foldername"
    foreach ($i in 1..$PodsCount)  {
		$PodName = $Pods[$i - 1].metadata.name
        Write-Host "Started DownloadConfig for Pod: $PodName"
		kkubectl cp $PodName`:/app/testConfigUser.json $PodName-testConfigUser.json  | out-null
		Write-Host "Completed DownloadConfig for Pod: $PodName"
    }
	Write-Host "DownloadConfig finished"
}

workflow GenerateConfig_internal{
	[CmdletBinding()]
    Param(
		[Parameter(Mandatory = $true)]
        [string]$NumOfDocsPerPod
    )
	$Tenants = @('1100','21220','1520','0900','0001','0002','0312','0420','0500','0920','0220','1420','1416','0112','11220')
	$Pods = $(kubectl get pods -n odsp-perf-lg-fluid --field-selector status.phase=Running -o json | ConvertFrom-Json).items
    [int]$PodsCount = $Pods.count
    Write-Output "GenerateConfig starting"
    foreach -parallel -ThrottleLimit 5 ($i in 1..$PodsCount) {
		$PodName = $Pods[$i - 1].metadata.name
		$TenantIndex = ($i-1) % $Tenants.count
		$TenantIdentifier = $Tenants[$TenantIndex]
        $Command = "node ./dist/createDocument.js --tenant $TenantIdentifier --numDoc $NumOfDocsPerPod > testscenario.logs 2>&1 &"
        Write-Output "Exec Command: $Command on Pod: $PodName"
		kubectl exec $PodName -n odsp-perf-lg-fluid -- bash -c $Command
		Write-Output "Exec Command DONE: on Pod: $PodName"
    }
	Write-Output "GenerateConfig completed"
}


function GenerateConfig {
	GenerateConfig_internal -NumOfDocsPerPod 300
}

workflow CopyLogsToAzure{
	[CmdletBinding()]
    Param(
		[Parameter(Mandatory = $true)]
        [string]$AccountKey,
		[Parameter(Mandatory = $true)]
        [string]$Namespace
    )
	$Pods = $(kubectl get pods -n $Namespace --field-selector status.phase=Running -o json | ConvertFrom-Json).items
    [int]$PodsCount = $Pods.count
	$datePath = Get-Date -Format "yyyy-MM-dd-HH-mm"
	az storage directory create --account-key $AccountKey  --account-name fluidwus2  --name $datePath --share-name lhy
    Write-Output "Copy Starting"
    foreach -parallel -ThrottleLimit 10 ($i in 1..$PodsCount) {
		$PodName = $Pods[$i - 1].metadata.name
		$Command = "az storage file upload --account-key $AccountKey  --account-name fluidwus2 --share-name lhy --source testscenario.logs --path $datePath\$PodName.log"
        Write-Output "Exec Command: $Command on Pod: $PodName"
		kubectl exec $PodName -n $Namespace -- bash -c $Command
        Write-Output "Exec Command DONE: on Pod: $PodName"
    }
	Write-Output "Copy Done"
	#kubectl delete namespace odsp-perf-lg-fluid
}

function DownloadLogsAndCopyToAzure {
	[CmdletBinding()]
    Param(
		[Parameter(Mandatory = $true)]
        [string]$AccountKey,
		[Parameter(Mandatory = $true)]
        [string]$Namespace
    )
	Write-Host "DownloadLogs started"
	kubectl config set-context --current --namespace $Namespace | out-null
	$Pods = $(kubectl get pods -n $Namespace --field-selector status.phase=Running -o json | ConvertFrom-Json).items
    [int]$PodsCount = $Pods.count
	$foldername = Get-Date -Format "yyyy-MM-dd-HH-mm"
	New-Item -Path $foldername -ItemType Directory | out-null
	az storage directory create --account-key $AccountKey  --account-name fluidwus2  --name $foldername --share-name lhy
	Write-Host "A new directory is created: $foldername"
	Write-Host "Logs will be downloaded in this new directory: $foldername"
    foreach ($i in 1..$PodsCount)  {
		$PodName = $Pods[$i - 1].metadata.name
        Write-Host "Started downloading logs for Pod: $PodName"
		kubectl cp $PodName`:/app/testscenario.logs $foldername/$PodName.logs  | out-null
		az storage file upload --account-key $AccountKey  --account-name fluidwus2 --share-name lhy --source $foldername/$PodName.logs --path $foldername
		Write-Host "Completed downloading logs for Pod: $PodName"
    }
	Write-Host "DownloadLogs finished"
	return $foldername
}
