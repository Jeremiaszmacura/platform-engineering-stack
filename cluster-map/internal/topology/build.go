package topology

import (
	"cmp"
	"regexp"
	"slices"
	"strings"

	corev1 "k8s.io/api/core/v1"
)

// SystemNamespaces hold cluster infrastructure; the page's tables cover every other namespace.
var SystemNamespaces = []string{"default", "ingress-nginx", "kube-node-lease", "kube-public", "kube-system", "local-path-storage"}

var clusterCIDRPattern = regexp.MustCompile(`clusterCIDR:\s*"?([^"\s]+)`)

// Build turns a snapshot of API objects into the map the page renders.
func Build(s Snapshot) Map {
	s.Pods = slices.SortedFunc(slices.Values(s.Pods), func(a, b *corev1.Pod) int {
		return cmp.Compare(podID(a.Namespace, a.Name), podID(b.Namespace, b.Name))
	})
	pods, refs := buildPods(s.Pods)
	services := buildServices(s.Services, s.Pods, s.Ingresses)
	perms := permissions(s)
	nodes := buildNodes(s.Nodes, pods)
	return Map{
		GeneratedAt:      s.TakenAt,
		Context:          s.ClusterName,
		Version:          s.Version,
		SystemNamespaces: SystemNamespaces,
		Ranges:           Ranges{Pods: clusterCIDR(s.ProxyConfig), Services: serviceRange(pods, s.Pods)},
		Nodes:            nodes,
		Pods:             pods,
		Services:         services,
		ServiceAccounts:  buildServiceAccounts(s.ServiceAccounts, pods, perms),
		Config:           buildConfigUses(pods, refs),
		Volumes:          buildVolumes(s.Claims, s.Volumes, s.Pods),
		Links:            buildLinks(s, pods, services, perms),
		NetworkPolicies:  policyIDs(s),
		Ingress:          ingressPlacement(pods, s.Pods, nodes),
	}
}

func buildPods(raw []*corev1.Pod) (pods []Pod, refs map[string][]configRef) {
	pods = make([]Pod, 0, len(raw))
	refs = map[string][]configRef{}
	for _, r := range raw {
		p, podRefs := buildPod(r)
		pods = append(pods, p)
		refs[p.ID] = podRefs
	}
	return pods, refs
}

func buildLinks(s Snapshot, pods []Pod, services []Service, perms map[string][]string) []Link {
	byID := map[string]Service{}
	for _, svc := range services {
		byID[svc.ID] = svc
	}
	return uniqueLinks(slices.Concat(
		ingressLinks(pods, services),
		configLinks(s.Pods, pods, s.References, byID),
		scrapeLinks(pods, services, s.PrometheusConfig),
		apiLinks(pods, perms),
	))
}

func policyIDs(s Snapshot) []string {
	ids := []string{}
	for _, np := range s.NetworkPolicies {
		ids = append(ids, podID(np.Namespace, np.Name))
	}
	slices.Sort(ids)
	return ids
}

func isSystem(namespace string) bool {
	return slices.Contains(SystemNamespaces, namespace)
}

func sortedUnique(values []string) []string {
	out := slices.Clone(values)
	slices.Sort(out)
	return append([]string{}, slices.Compact(out)...)
}

func uniqueLinks(links []Link) []Link {
	seen := map[[3]string]bool{}
	out := []Link{}
	for _, l := range links {
		key := [3]string{l.Source, l.Target, l.Kind}
		if !seen[key] {
			seen[key] = true
			out = append(out, l)
		}
	}
	return out
}

func clusterCIDR(proxyConfig string) string {
	if m := clusterCIDRPattern.FindStringSubmatch(proxyConfig); m != nil {
		return m[1]
	}
	return ""
}

func findFlag(command []string, flag string) string {
	for _, part := range command {
		if value, ok := strings.CutPrefix(part, "--"+flag+"="); ok {
			return value
		}
	}
	return ""
}

// serviceRange reads the Service CIDR from the kube-apiserver static pod's flags.
func serviceRange(pods []Pod, raw []*corev1.Pod) string {
	for i, p := range pods {
		if p.App == "kube-apiserver" && len(raw[i].Spec.Containers) > 0 {
			return findFlag(raw[i].Spec.Containers[0].Command, "service-cluster-ip-range")
		}
	}
	return ""
}

func ingressPlacement(pods []Pod, raw []*corev1.Pod, nodes []Node) IngressPlacement {
	placement := IngressPlacement{RunningOn: []string{}, IngressReadyNodes: []string{}}
	for _, n := range nodes {
		if n.IngressReady {
			placement.IngressReadyNodes = append(placement.IngressReadyNodes, n.Name)
		}
	}
	pinned := true
	for i, p := range pods {
		if p.Namespace == "ingress-nginx" && p.Owner == "Deployment" && p.Phase == string(corev1.PodRunning) {
			placement.RunningOn = append(placement.RunningOn, p.Node)
			pinned = pinned && raw[i].Spec.NodeSelector["ingress-ready"] == "true"
		}
	}
	placement.Pinned = pinned && len(placement.RunningOn) > 0
	return placement
}
