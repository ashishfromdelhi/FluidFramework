function RunLoadTest {

    [CmdletBinding()]
    Param(
        [Parameter(Mandatory = $true)]
        [string]$NumOfPods,
		[Parameter(Mandatory = $true)]
        [string]$NumOfDocsPerPod,
		[Parameter(Mandatory = $true)]
        [string]$Profile
    )

    Write-Host "Starting RunLoadTest NumOfPods: $NumOfPods, NumOfDocsPerPod: $NumOfDocsPerPod, Profile: $Profile"
	kubectl config set-context --current --namespace=odsp-perf-lg-fluid | out-null
	CreateInfra -NumOfPods $NumOfPods
	$Pods = $(kubectl get pods -n odsp-perf-lg-fluid --field-selector status.phase=Running -o json | ConvertFrom-Json).items
	$PodName = $Pods[0].metadata.name
	#GenerateConfig -PodName $PodName -NumOfDocsPerTenant 2
	#DownloadConfig -PodName $PodName
	#UploadConfig
	RunTest -NumOfDocsPerPod $NumOfDocsPerPod -Profile $Profile
}

function CreateInfra{

	[CmdletBinding()]
    Param(
        [Parameter(Mandatory = $true)]
        [string]$NumOfPods
    )

	kubectl create namespace odsp-perf-lg-fluid
	kubectl apply -f load-generator-fluid-app.yaml -n odsp-perf-lg-fluid
    kubectl scale deployments lg-fluidapp -n odsp-perf-lg-fluid --replicas=$NumOfPods
    $RunningNumOfPods = $(kubectl get pods -n odsp-perf-lg-fluid --field-selector status.phase=Running).count -1
    while ($NumOfPods -ne $RunningNumOfPods) {
        Write-Host "Pods are in-progress"
        Start-Sleep -s 10
        $RunningNumOfPods = $(kubectl get pods -n odsp-perf-lg-fluid  --field-selector status.phase=Running).count -1
    }
    Write-Host "Pods are created and running"
}

workflow RunTest{
	[CmdletBinding()]
    Param(
		[Parameter(Mandatory = $true)]
        [string]$NumOfDocsPerPod,
		[Parameter(Mandatory = $true)]
        [string]$Profile
    )
	$Tenants = @('1020', '1100', '1220', '1520', '0900', '0001', '0002', '0312', '0420' ,'0500')
	$Pods = $(kubectl get pods -n odsp-perf-lg-fluid --field-selector status.phase=Running -o json | ConvertFrom-Json).items
    [int]$PodsCount = $Pods.count
    Write-Output "Load Starting"
    foreach -parallel -ThrottleLimit 10 ($i in 1..$PodsCount) {
		$PodName = $Pods[$i - 1].metadata.name
		$TenantIndex = ($i-1) % $Tenants.count
		$TenantIdentifier = $Tenants[$TenantIndex]
		$PodId=[int][Math]::Floor(($i + $Tenants.count -1)/$Tenants.count)
        $Command = "node ./dist/nodeStressTest.js --tenant $TenantIdentifier --profile $Profile --numDoc $NumOfDocsPerPod --podId $PodId > testscenario.logs 2>&1 &"
        Write-Output "Exec Command: $Command on Pod: $PodName"
		kubectl exec $PodName -n odsp-perf-lg-fluid -- bash -c $Command
    }
	Write-Output "Load Submitted"
	#kubectl delete namespace odsp-perf-lg-fluid
}

function DownloadLogs {
	Write-Host "DownloadLogs started"
	kubectl config set-context --current --namespace=odsp-perf-lg-fluid | out-null
	$Pods = $(kubectl get pods -n odsp-perf-lg-fluid --field-selector status.phase=Running -o json | ConvertFrom-Json).items
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
	[CmdletBinding()]
    Param(
		[Parameter(Mandatory = $true)]
        [string]$PodName
    )
	Write-Host "DownloadConfig started"
	kubectl config set-context --current --namespace=odsp-perf-lg-fluid | out-null
	kubectl cp $PodName`:/app/testConfigUser.json testConfigUser.json  | out-null
	Write-Host "DownloadConfig finished"
}

function GenerateConfig{
	[CmdletBinding()]
    Param(
		[Parameter(Mandatory = $true)]
        [string]$PodName,
		[Parameter(Mandatory = $true)]
        [string]$NumOfDocsPerTenant
    )
	$Tenants = @('1020', '1100', '1220', '1520', '0900', '0001', '0002', '0312', '0420' ,'0500')
	[int]$TenantsCount = $Tenants.count
    Write-Host "GenerateConfig starting"
	foreach ($i in 1..$TenantsCount) {
		$TenantName = $Tenants[$i - 1]
        $Command = "node ./dist/createDocument.js --tenant $TenantName --numDoc $NumOfDocsPerTenant >> docGenerator.logs 2>&1"
        Write-Host "Exec Command: $Command on Pod: $PodName"
		kubectl exec $PodName -n odsp-perf-lg-fluid -- bash -c $Command
    }
	Write-Host "GenerateConfig completed"

}
