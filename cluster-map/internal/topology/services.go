package topology

import (
	"fmt"
	"net/url"
	"regexp"
	"slices"
	"strings"

	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
)

var sdNamespacesPattern = regexp.MustCompile(`names:\s*\[([^\]]*)\]`)

type route struct {
	host string
	cors bool
}

func ingressRoutes(ingresses []*networkingv1.Ingress) map[string][]route {
	routes := map[string][]route{}
	for _, ing := range ingresses {
		cors := ing.Annotations["nginx.ingress.kubernetes.io/enable-cors"] == "true"
		for _, rule := range ing.Spec.Rules {
			if rule.HTTP == nil {
				continue
			}
			for _, path := range rule.HTTP.Paths {
				if path.Backend.Service == nil {
					continue
				}
				id := podID(ing.Namespace, path.Backend.Service.Name)
				routes[id] = append(routes[id], route{rule.Host, cors})
			}
		}
	}
	return routes
}

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

func buildServices(services []*corev1.Service, pods []*corev1.Pod, ingresses []*networkingv1.Ingress) []Service {
	routes := ingressRoutes(ingresses)
	out := make([]Service, 0, len(services))
	for _, s := range services {
		id := podID(s.Namespace, s.Name)
		svc := Service{
			ID:           id,
			Name:         s.Name,
			Namespace:    s.Namespace,
			Type:         string(s.Spec.Type),
			ClusterIP:    s.Spec.ClusterIP,
			DNS:          fmt.Sprintf("%s.%s.svc.cluster.local", s.Name, s.Namespace),
			Scraped:      s.Annotations["prometheus.io/scrape"] == "true",
			Job:          s.Annotations["prometheus.io/job"],
			IngressHosts: []string{},
		}
		svc.Ports, svc.TargetPorts = servicePorts(s)
		for _, r := range routes[id] {
			svc.IngressHosts = append(svc.IngressHosts, r.host)
			svc.CORS = svc.CORS || r.cors
		}
		svc.Pods = selectedPods(s, pods)
		out = append(out, svc)
	}
	slices.SortFunc(out, func(a, b Service) int { return strings.Compare(a.ID, b.ID) })
	return out
}

func servicePorts(s *corev1.Service) (ports, targets []string) {
	ports, targets = []string{}, []string{}
	for _, p := range s.Spec.Ports {
		target := p.TargetPort.String()
		if p.TargetPort.IntValue() == 0 && p.TargetPort.StrVal == "" {
			target = fmt.Sprint(p.Port)
		}
		ports = append(ports, fmt.Sprintf("%d → %s/%s", p.Port, target, p.Protocol))
		targets = append(targets, target)
	}
	return ports, targets
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

func ingressLinks(pods []Pod, services []Service) []Link {
	var links []Link
	for _, c := range pods {
		if c.Namespace != "ingress-nginx" || c.Owner != "Deployment" || c.Phase != string(corev1.PodRunning) {
			continue
		}
		for _, svc := range services {
			for _, host := range svc.IngressHosts {
				for _, target := range svc.Pods {
					links = append(links, Link{c.ID, target, host, "ingress"})
				}
			}
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
