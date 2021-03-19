
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

    Write-Host "Starting RunLoadTest NumOfPods: $NumOfPods, NumOfDocsPerPod: $NumOfDocsPerPod"
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
	Write-Host "Load Starting"
	$Pods = $(kubectl get pods -n odsp-perf-lg-fluid --field-selector status.phase=Running -o json | ConvertFrom-Json).items
    [int]$PodsCount = $Pods.count
    foreach ($i in 1..$PodsCount) {
		$PodName = $Pods[$i - 1].metadata.name
        $Command = "node ./dist/nodeStressTest.js --tenant 0312 --profile $Profile --numDoc $NumOfDocsPerPod --podId $i --numPod $NumOfPods > testscenario.logs &"
        Write-Host "Exec Command: $Command on Pod: $PodName"
		kubectl exec $PodName -n odsp-perf-lg-fluid -- bash -c $Command
    }
	Write-Host "Load Submited"
	#kubectl delete namespace odsp-perf-lg-fluid
}