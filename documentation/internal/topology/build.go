package topology

import (
	"cmp"
	"regexp"
	"slices"
	"strings"

	corev1 "k8s.io/api/core/v1"
)

// SystemNamespaces hold cluster infrastructure; the page's tables cover every other namespace.
var SystemNamespaces = []string{
	"default", "envoy-gateway-system", "kube-node-lease", "kube-public", "kube-system", "local-path-storage",
}

var clusterCIDRPattern = regexp.MustCompile(`clusterCIDR:\s*"?([^"\s]+)`)

// Build turns a snapshot of API objects into the map the page renders.
func Build(s Snapshot) Map {
	s.Pods = slices.SortedFunc(slices.Values(s.Pods), func(a, b *corev1.Pod) int {
		return cmp.Compare(podID(a.Namespace, a.Name), podID(b.Namespace, b.Name))
	})
	pods, refs := buildPods(s.Pods)
	routes := buildRoutes(s.HTTPRoutes)
	perms := permissions(s)
	m := Map{
		GeneratedAt:      s.TakenAt,
		Context:          s.ClusterName,
		Version:          s.Version,
		SystemNamespaces: SystemNamespaces,
		Ranges:           Ranges{Pods: clusterCIDR(s.ProxyConfig), Services: serviceRange(pods, s.Pods)},
		Nodes:            buildNodes(s.Nodes, pods),
		Pods:             pods,
		Services:         buildServices(s.Services, s.Pods, routes),
		Gateways:         buildGateways(s.Gateways, s.Pods, s.Services),
		Routes:           routes,
		ServiceAccounts:  buildServiceAccounts(s.ServiceAccounts, pods, perms),
		Config:           buildConfigUses(pods, refs),
		Volumes:          buildVolumes(s.Claims, s.Volumes, s.Pods),
		NetworkPolicies:  policyIDs(s),
	}
	m.Links = buildLinks(s, m, perms)
	return m
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

// buildLinks finds every connection between pods, from the map built so far and the raw pod specs.
func buildLinks(s Snapshot, m Map, perms map[string][]string) []Link {
	byID := map[string]Service{}
	for _, svc := range m.Services {
		byID[svc.ID] = svc
	}
	return uniqueLinks(slices.Concat(
		gatewayLinks(m.Gateways, m.Routes, byID),
		configLinks(s.Pods, m.Pods, s.References, byID),
		scrapeLinks(m.Pods, m.Services, s.PrometheusConfig),
		apiLinks(m.Pods, perms),
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
