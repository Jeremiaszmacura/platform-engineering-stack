package topology

import (
	"slices"

	corev1 "k8s.io/api/core/v1"
)

// hardening checks a pod's containers, init containers included, the way the Pod Security Standards'
// restricted profile does, plus a read-only root filesystem and resource limits.
func hardening(spec corev1.PodSpec) Hardening {
	pod := spec.SecurityContext
	return Hardening{
		NonRoot:               every(spec, func(c corev1.Container) bool { return nonRoot(pod, c.SecurityContext) }),
		ReadOnlyRoot:          every(spec, readOnlyRoot),
		NoPrivilegeEscalation: every(spec, noPrivilegeEscalation),
		DropsAllCapabilities:  every(spec, dropsAllCapabilities),
		AddedCapabilities:     addedCapabilities(spec),
		Seccomp:               every(spec, func(c corev1.Container) bool { return confined(pod, c.SecurityContext) }),
		HostAccess:            hostAccess(spec),
		Limits:                every(spec, hasLimits),
	}
}

func every(spec corev1.PodSpec, check func(corev1.Container) bool) bool {
	return !slices.ContainsFunc(allContainers(spec), func(c corev1.Container) bool { return !check(c) })
}

// nonRoot is true when runAsNonRoot is set on the container or, if unset there, on the pod: only then does the
// kubelet refuse an image that would run as root.
func nonRoot(pod *corev1.PodSecurityContext, c *corev1.SecurityContext) bool {
	if c != nil && c.RunAsNonRoot != nil {
		return *c.RunAsNonRoot
	}
	return pod != nil && pod.RunAsNonRoot != nil && *pod.RunAsNonRoot
}

func readOnlyRoot(c corev1.Container) bool {
	sc := c.SecurityContext
	return sc != nil && sc.ReadOnlyRootFilesystem != nil && *sc.ReadOnlyRootFilesystem
}

// noPrivilegeEscalation needs an explicit false: the default allows setuid binaries to gain privileges.
func noPrivilegeEscalation(c corev1.Container) bool {
	sc := c.SecurityContext
	return sc != nil && sc.AllowPrivilegeEscalation != nil && !*sc.AllowPrivilegeEscalation
}

func dropsAllCapabilities(c corev1.Container) bool {
	sc := c.SecurityContext
	return sc != nil && sc.Capabilities != nil && slices.Contains(sc.Capabilities.Drop, "ALL")
}

func addedCapabilities(spec corev1.PodSpec) []string {
	var added []string
	for _, c := range allContainers(spec) {
		if c.SecurityContext != nil && c.SecurityContext.Capabilities != nil {
			for _, capability := range c.SecurityContext.Capabilities.Add {
				added = append(added, string(capability))
			}
		}
	}
	return sortedUnique(added)
}

// confined is true for the RuntimeDefault or a Localhost seccomp profile, set on the container or the pod.
// With no profile the runtime runs the container unconfined.
func confined(pod *corev1.PodSecurityContext, c *corev1.SecurityContext) bool {
	var profile *corev1.SeccompProfile
	if pod != nil {
		profile = pod.SeccompProfile
	}
	if c != nil && c.SeccompProfile != nil {
		profile = c.SeccompProfile
	}
	return profile != nil && (profile.Type == corev1.SeccompProfileTypeRuntimeDefault ||
		profile.Type == corev1.SeccompProfileTypeLocalhost)
}

// hostAccess lists the ways a pod shares the node's namespaces or files.
func hostAccess(spec corev1.PodSpec) []string {
	access := []string{}
	if spec.HostNetwork {
		access = append(access, "hostNetwork")
	}
	if spec.HostPID {
		access = append(access, "hostPID")
	}
	if spec.HostIPC {
		access = append(access, "hostIPC")
	}
	if slices.ContainsFunc(spec.Volumes, func(v corev1.Volume) bool { return v.HostPath != nil }) {
		access = append(access, "hostPath")
	}
	return access
}

func hasLimits(c corev1.Container) bool {
	_, cpu := c.Resources.Limits[corev1.ResourceCPU]
	_, memory := c.Resources.Limits[corev1.ResourceMemory]
	return cpu && memory
}
