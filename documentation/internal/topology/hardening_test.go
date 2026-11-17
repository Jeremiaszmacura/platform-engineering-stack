package topology

import (
	"reflect"
	"testing"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
)

// lockedDown is a container that passes every check except seccomp, which only the pod sets here.
func lockedDown() corev1.Container {
	yes, no := true, false
	return corev1.Container{
		SecurityContext: &corev1.SecurityContext{
			RunAsNonRoot: &yes, ReadOnlyRootFilesystem: &yes, AllowPrivilegeEscalation: &no,
			Capabilities: &corev1.Capabilities{Drop: []corev1.Capability{"ALL"}},
		},
		Resources: corev1.ResourceRequirements{Limits: corev1.ResourceList{
			corev1.ResourceCPU: resource.MustParse("100m"), corev1.ResourceMemory: resource.MustParse("64Mi"),
		}},
	}
}

func TestHardening(t *testing.T) {
	runtimeDefault := &corev1.PodSecurityContext{SeccompProfile: &corev1.SeccompProfile{Type: corev1.SeccompProfileTypeRuntimeDefault}}
	yes, no := true, false
	optsOut := lockedDown()
	optsOut.SecurityContext.RunAsNonRoot = &no
	privileged := corev1.Container{SecurityContext: &corev1.SecurityContext{
		Capabilities: &corev1.Capabilities{Add: []corev1.Capability{"IPC_LOCK"}},
	}}
	hostPath := corev1.Volume{VolumeSource: corev1.VolumeSource{HostPath: &corev1.HostPathVolumeSource{Path: "/proc"}}}
	tests := []struct {
		name string
		spec corev1.PodSpec
		want Hardening
	}{
		{"every check passes", corev1.PodSpec{SecurityContext: runtimeDefault, Containers: []corev1.Container{lockedDown()}},
			Hardening{NonRoot: true, ReadOnlyRoot: true, NoPrivilegeEscalation: true, DropsAllCapabilities: true,
				AddedCapabilities: []string{}, Seccomp: true, HostAccess: []string{}, Limits: true}},
		{"nothing set", corev1.PodSpec{Containers: []corev1.Container{{}}},
			Hardening{AddedCapabilities: []string{}, HostAccess: []string{}}},
		{"pod-level non-root, but one container opts out", corev1.PodSpec{
			SecurityContext: &corev1.PodSecurityContext{RunAsNonRoot: &yes},
			Containers:      []corev1.Container{lockedDown(), optsOut},
		}, Hardening{ReadOnlyRoot: true, NoPrivilegeEscalation: true, DropsAllCapabilities: true,
			AddedCapabilities: []string{}, HostAccess: []string{}, Limits: true}},
		{"an init container counts", corev1.PodSpec{InitContainers: []corev1.Container{{}}, Containers: []corev1.Container{lockedDown()}},
			Hardening{AddedCapabilities: []string{}, HostAccess: []string{}}},
		{"host access and an added capability", corev1.PodSpec{
			HostNetwork: true, HostPID: true, Volumes: []corev1.Volume{hostPath}, Containers: []corev1.Container{privileged},
		}, Hardening{AddedCapabilities: []string{"IPC_LOCK"}, HostAccess: []string{"hostNetwork", "hostPID", "hostPath"}}},
	}
	for _, tt := range tests {
		if got := hardening(tt.spec); !reflect.DeepEqual(got, tt.want) {
			t.Errorf("%s:\n got %+v\nwant %+v", tt.name, got, tt.want)
		}
	}
}

func TestConfinedContainerProfileWins(t *testing.T) {
	pod := &corev1.PodSecurityContext{SeccompProfile: &corev1.SeccompProfile{Type: corev1.SeccompProfileTypeRuntimeDefault}}
	unconfined := &corev1.SecurityContext{SeccompProfile: &corev1.SeccompProfile{Type: corev1.SeccompProfileTypeUnconfined}}
	if confined(pod, unconfined) {
		t.Error("a container's Unconfined profile must override the pod's RuntimeDefault")
	}
	if !confined(pod, nil) {
		t.Error("a container without a profile must inherit the pod's RuntimeDefault")
	}
}
