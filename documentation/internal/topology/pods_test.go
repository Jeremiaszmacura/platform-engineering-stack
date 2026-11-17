package topology

import (
	"slices"
	"testing"

	corev1 "k8s.io/api/core/v1"
)

func TestBuildPodStatus(t *testing.T) {
	p := pod("data", "db-0", "StatefulSet", "10.0.0.7", corev1.PodSpec{
		InitContainers: []corev1.Container{{Image: "db:1"}},
		Containers:     []corev1.Container{{Image: "db:1"}, {Image: "exporter:2"}},
	})
	p.Status.Conditions = []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionTrue}}
	p.Status.ContainerStatuses = []corev1.ContainerStatus{{RestartCount: 2}, {RestartCount: 1}}

	got, _ := buildPod(p)
	if !got.Ready || got.Restarts != 3 || !slices.Equal(got.Images, []string{"db:1", "exporter:2"}) {
		t.Errorf("ready %v, restarts %d, images %v; want true, 3, [db:1 exporter:2]", got.Ready, got.Restarts, got.Images)
	}

	p.Status.Conditions[0].Status = corev1.ConditionFalse
	if got, _ := buildPod(p); got.Ready {
		t.Error("a pod whose Ready condition is False must not be ready")
	}
}
