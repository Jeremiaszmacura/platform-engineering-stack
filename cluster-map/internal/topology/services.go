package topology

import (
	"fmt"
	"net/url"
	"regexp"
	"slices"
	"strings"

	corev1 "k8s.io/api/core/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

var sdNamespacesPattern = regexp.MustCompile(`names:\s*\[([^\]]*)\]`)

func selects(selector, labels map[string]string) bool {
	if len(selector) == 0 {
		return false
	}
	for key, value := range selector {
		if labels[key] != value {
			return false
		}
	}
	return true
}

func buildServices(services []*corev1.Service, pods []*corev1.Pod, routes []Route) []Service {
	out := make([]Service, 0, len(services))
	for _, s := range services {
		svc := Service{
			ID:        podID(s.Namespace, s.Name),
			Name:      s.Name,
			Namespace: s.Namespace,
			Type:      string(s.Spec.Type),
			ClusterIP: s.Spec.ClusterIP,
			DNS:       fmt.Sprintf("%s.%s.svc.cluster.local", s.Name, s.Namespace),
			Scraped:   s.Annotations["prometheus.io/scrape"] == "true",
			Job:       s.Annotations["prometheus.io/job"],
		}
		svc.Ports, svc.TargetPorts, svc.NodePorts = servicePorts(s)
		svc.Hostnames, svc.CORS = routedHostnames(svc.ID, routes)
		svc.Pods = selectedPods(s, pods)
		out = append(out, svc)
	}
	slices.SortFunc(out, func(a, b Service) int { return strings.Compare(a.ID, b.ID) })
	return out
}

// routedHostnames returns the hostnames accepted routes send to a Service, and whether one of them adds CORS.
func routedHostnames(serviceID string, routes []Route) (hostnames []string, cors bool) {
	hostnames = []string{}
	for _, r := range routes {
		targeted := slices.ContainsFunc(r.Backends, func(b Backend) bool { return b.Service == serviceID })
		if !r.Accepted || !targeted {
			continue
		}
		hostnames = append(hostnames, r.Hostnames...)
		cors = cors || slices.Contains(r.Filters, string(gatewayv1.HTTPRouteFilterCORS))
	}
	return hostnames, cors
}

// servicePorts describes each port as "port → targetPort/protocol", plus the ports a NodePort Service opens on nodes.
func servicePorts(s *corev1.Service) (ports, targets, nodePorts []string) {
	ports, targets, nodePorts = []string{}, []string{}, []string{}
	for _, p := range s.Spec.Ports {
		target := p.TargetPort.String()
		if p.TargetPort.IntValue() == 0 && p.TargetPort.StrVal == "" {
			target = fmt.Sprint(p.Port)
		}
		port := fmt.Sprintf("%d → %s/%s", p.Port, target, p.Protocol)
		if p.NodePort != 0 {
			port += fmt.Sprintf(" (nodePort %d)", p.NodePort)
			nodePorts = append(nodePorts, fmt.Sprint(p.NodePort))
		}
		ports = append(ports, port)
		targets = append(targets, target)
	}
	return ports, targets, nodePorts
}

func selectedPods(s *corev1.Service, pods []*corev1.Pod) []string {
	selected := []string{}
	for _, p := range pods {
		if p.Namespace == s.Namespace && p.Status.Phase == corev1.PodRunning && selects(s.Spec.Selector, p.Labels) {
			selected = append(selected, podID(p.Namespace, p.Name))
		}
	}
	return selected
}

// referencedHost returns the host and port of a URL or host[:port] value, or empty strings.
func referencedHost(value string) (host, port string) {
	raw := value
	if !strings.Contains(value, "://") {
		raw = "//" + value
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", ""
	}
	return u.Hostname(), u.Port()
}

// resolveService finds the Service a value points to, following the pod's DNS search list rules.
func resolveService(value, namespace string, services map[string]Service) (Service, string, bool) {
	host, port := referencedHost(value)
	labels := strings.Split(host, ".")
	if host == "" || (len(labels) > 2 && labels[2] != "svc") {
		return Service{}, "", false
	}
	if len(labels) > 1 {
		namespace = labels[1]
	}
	svc, ok := services[podID(namespace, labels[0])]
	if !ok {
		return Service{}, "", false
	}
	if port == "" && len(svc.Ports) > 0 {
		port = strings.Fields(svc.Ports[0])[0]
	}
	return svc, host + ":" + port, true
}

func serviceLinks(source, value, namespace string, services map[string]Service) []Link {
	svc, label, ok := resolveService(value, namespace, services)
	if !ok {
		return nil
	}
	var links []Link
	for _, target := range svc.Pods {
		if target != source {
			links = append(links, Link{source, target, label, "call"})
		}
	}
	return links
}

func configLinks(pods []*corev1.Pod, appPods []Pod, refs []Reference, services map[string]Service) []Link {
	var links []Link
	for _, p := range pods {
		for _, c := range allContainers(p.Spec) {
			for _, env := range c.Env {
				if env.Value != "" {
					links = append(links, serviceLinks(podID(p.Namespace, p.Name), env.Value, p.Namespace, services)...)
				}
			}
		}
	}
	for _, ref := range refs {
		for _, p := range appPods {
			if p.App == ref.App {
				links = append(links, serviceLinks(p.ID, ref.Value, p.Namespace, services)...)
			}
		}
	}
	return links
}

// sdNamespaces returns the namespaces Prometheus' kubernetes_sd is limited to; empty means all.
func sdNamespaces(prometheusConfig string) []string {
	match := sdNamespacesPattern.FindStringSubmatch(prometheusConfig)
	if match == nil {
		return nil
	}
	var names []string
	for _, name := range strings.Split(match[1], ",") {
		names = append(names, strings.TrimSpace(name))
	}
	return names
}

func scrapeLinks(pods []Pod, services []Service, prometheusConfig string) []Link {
	namespaces := sdNamespaces(prometheusConfig)
	byID := map[string]Pod{}
	for _, p := range pods {
		byID[p.ID] = p
	}
	var links []Link
	for _, scraper := range pods {
		if scraper.App != "prometheus" {
			continue
		}
		for _, svc := range services {
			if !svc.Scraped || len(svc.TargetPorts) == 0 || (namespaces != nil && !slices.Contains(namespaces, svc.Namespace)) {
				continue
			}
			for _, target := range svc.Pods {
				label := fmt.Sprintf("scrape %s:%s/metrics (job %s)", byID[target].IP, svc.TargetPorts[0], svc.Job)
				links = append(links, Link{scraper.ID, target, label, "scrape"})
			}
		}
	}
	return links
}

func apiLinks(pods []Pod, permissions map[string][]string) []Link {
	var links []Link
	for _, server := range pods {
		if server.App != "kube-apiserver" {
			continue
		}
		for _, p := range pods {
			if p.TokenMounted && len(permissions[podID(p.Namespace, p.ServiceAccount)]) > 0 && !isNodeAgent(p) {
				links = append(links, Link{p.ID, server.ID, "Kubernetes API (ServiceAccount token)", "api"})
			}
		}
	}
	return links
}
