package topology

import (
	"slices"
	"strings"

	corev1 "k8s.io/api/core/v1"
)

// Projected volume Kubernetes injects when a pod gets an API token.
const apiAccessVolumePrefix = "kube-api-access-"

var appLabels = []string{"app", "app.kubernetes.io/name", "k8s-app", "component"}

// configRef is one place a pod reads a Secret or ConfigMap.
type configRef struct {
	kind, name, key, how string
}

func (r configRef) String() string {
	if r.key == "" {
		return r.name + " → " + r.how
	}
	return r.name + "/" + r.key + " → " + r.how
}

func podID(namespace, name string) string {
	return namespace + "/" + name
}

func appName(labels map[string]string, fallback string) string {
	for _, key := range appLabels {
		if labels[key] != "" {
			return labels[key]
		}
	}
	return fallback
}

func ownerKind(p *corev1.Pod) string {
	if len(p.OwnerReferences) == 0 {
		return "Pod"
	}
	if kind := p.OwnerReferences[0].Kind; kind != "ReplicaSet" {
		return kind
	}
	return "Deployment"
}

func allContainers(spec corev1.PodSpec) []corev1.Container {
	return slices.Concat(spec.InitContainers, spec.Containers)
}

func mountPaths(spec corev1.PodSpec) map[string]string {
	paths := map[string]string{}
	for _, c := range allContainers(spec) {
		for _, m := range c.VolumeMounts {
			if _, seen := paths[m.Name]; !seen {
				paths[m.Name] = m.MountPath
			}
		}
	}
	return paths
}

func configRefs(spec corev1.PodSpec) []configRef {
	var refs []configRef
	for _, c := range allContainers(spec) {
		refs = append(refs, envRefs(c)...)
	}
	paths := mountPaths(spec)
	for _, v := range spec.Volumes {
		if v.Secret != nil {
			refs = append(refs, configRef{"Secret", v.Secret.SecretName, "", "volume at " + paths[v.Name]})
		}
		if v.ConfigMap != nil {
			refs = append(refs, configRef{"ConfigMap", v.ConfigMap.Name, "", "volume at " + paths[v.Name]})
		}
	}
	return refs
}

func envRefs(c corev1.Container) []configRef {
	var refs []configRef
	for _, env := range c.Env {
		if env.ValueFrom == nil {
			continue
		}
		if ref := env.ValueFrom.SecretKeyRef; ref != nil {
			refs = append(refs, configRef{"Secret", ref.Name, ref.Key, env.Name})
		}
		if ref := env.ValueFrom.ConfigMapKeyRef; ref != nil {
			refs = append(refs, configRef{"ConfigMap", ref.Name, ref.Key, env.Name})
		}
	}
	for _, from := range c.EnvFrom {
		if from.SecretRef != nil {
			refs = append(refs, configRef{"Secret", from.SecretRef.Name, "", "all keys as env"})
		}
		if from.ConfigMapRef != nil {
			refs = append(refs, configRef{"ConfigMap", from.ConfigMapRef.Name, "", "all keys as env"})
		}
	}
	return refs
}

func describeVolumes(spec corev1.PodSpec) []string {
	paths := mountPaths(spec)
	volumes := []string{}
	for _, v := range spec.Volumes {
		at := paths[v.Name]
		switch {
		case v.PersistentVolumeClaim != nil:
			volumes = append(volumes, "PVC "+v.PersistentVolumeClaim.ClaimName+" at "+at)
		case v.EmptyDir != nil:
			volumes = append(volumes, "emptyDir at "+at)
		case v.HostPath != nil:
			volumes = append(volumes, "hostPath "+v.HostPath.Path+" at "+at)
		}
	}
	return volumes
}

func describeProbe(kind string, p *corev1.Probe) string {
	switch {
	case p.HTTPGet != nil:
		return kind + ": GET " + p.HTTPGet.Path + " :" + p.HTTPGet.Port.String()
	case p.Exec != nil:
		return kind + ": exec " + strings.Join(p.Exec.Command, " ")
	case p.TCPSocket != nil:
		return kind + ": TCP :" + p.TCPSocket.Port.String()
	}
	return kind + ": other"
}

func probes(spec corev1.PodSpec) []string {
	found := []string{}
	for _, c := range spec.Containers {
		if c.ReadinessProbe != nil {
			found = append(found, describeProbe("readiness", c.ReadinessProbe))
		}
		if c.LivenessProbe != nil {
			found = append(found, describeProbe("liveness", c.LivenessProbe))
		}
	}
	return found
}

func hasToken(spec corev1.PodSpec) bool {
	return slices.ContainsFunc(spec.Volumes, func(v corev1.Volume) bool {
		return strings.HasPrefix(v.Name, apiAccessVolumePrefix)
	})
}

func refStrings(refs []configRef, kind string) []string {
	out := []string{}
	for _, r := range refs {
		if r.kind == kind {
			out = append(out, r.String())
		}
	}
	return sortedUnique(out)
}

func buildPod(p *corev1.Pod) (Pod, []configRef) {
	refs := configRefs(p.Spec)
	account := p.Spec.ServiceAccountName
	if account == "" {
		account = "default"
	}
	return Pod{
		ID:             podID(p.Namespace, p.Name),
		Name:           p.Name,
		Namespace:      p.Namespace,
		App:            appName(p.Labels, p.Name),
		IP:             p.Status.PodIP,
		Node:           p.Spec.NodeName,
		HostNetwork:    p.Spec.HostNetwork,
		Phase:          string(p.Status.Phase),
		Owner:          ownerKind(p),
		ServiceAccount: account,
		TokenMounted:   hasToken(p.Spec),
		Secrets:        refStrings(refs, "Secret"),
		ConfigMaps:     refStrings(refs, "ConfigMap"),
		Volumes:        describeVolumes(p.Spec),
		Probes:         probes(p.Spec),
	}, refs
}

// isNodeAgent is true for kube-system static pods and DaemonSets, which the page lists per node.
func isNodeAgent(p Pod) bool {
	return p.Namespace == "kube-system" && (p.Owner == "Node" || p.Owner == "DaemonSet") && p.App != "kube-apiserver"
}

func buildNodes(nodes []*corev1.Node, pods []Pod) []Node {
	out := make([]Node, 0, len(nodes))
	for _, n := range nodes {
		node := Node{
			Name:         n.Name,
			PodCIDR:      n.Spec.PodCIDR,
			Roles:        []string{},
			Taints:       []string{},
			IngressReady: n.Labels["ingress-ready"] == "true",
		}
		for _, a := range n.Status.Addresses {
			if a.Type == corev1.NodeInternalIP {
				node.IP = a.Address
			}
		}
		for key := range n.Labels {
			if role, ok := strings.CutPrefix(key, "node-role.kubernetes.io/"); ok {
				node.Roles = append(node.Roles, role)
			}
		}
		slices.Sort(node.Roles)
		for _, t := range n.Spec.Taints {
			node.Taints = append(node.Taints, t.Key+":"+string(t.Effect))
		}
		var agents []string
		for _, p := range pods {
			if p.Node == n.Name && isNodeAgent(p) {
				agents = append(agents, p.App)
			}
		}
		node.Agents = sortedUnique(agents)
		out = append(out, node)
	}
	slices.SortFunc(out, func(a, b Node) int {
		return strings.Compare(nodeSortKey(a), nodeSortKey(b))
	})
	return out
}

func nodeSortKey(n Node) string {
	if slices.Contains(n.Roles, "control-plane") {
		return "0" + n.Name
	}
	return "1" + n.Name
}
