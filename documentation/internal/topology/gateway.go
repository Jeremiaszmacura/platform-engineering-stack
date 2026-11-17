package topology

import (
	"cmp"
	"slices"
	"strings"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// buildGateways describes each Gateway with the proxy pods and Service its controller created for it.
func buildGateways(gateways []*gatewayv1.Gateway, pods []*corev1.Pod, services []*corev1.Service) []Gateway {
	out := make([]Gateway, 0, len(gateways))
	for _, g := range gateways {
		out = append(out, Gateway{
			ID:           podID(g.Namespace, g.Name),
			Name:         g.Name,
			Namespace:    g.Namespace,
			Class:        string(g.Spec.GatewayClassName),
			Programmed:   meta.IsStatusConditionTrue(g.Status.Conditions, string(gatewayv1.GatewayConditionProgrammed)),
			Addresses:    gatewayAddresses(g.Status.Addresses),
			Listeners:    buildListeners(g),
			ProxyPods:    proxyPods(g, pods),
			ProxyService: proxyService(g, services),
		})
	}
	slices.SortFunc(out, func(a, b Gateway) int { return cmp.Compare(a.ID, b.ID) })
	return out
}

// servesGateway reports whether an object was generated for Gateway g: implementations label the proxy
// pods and Service they create with the Gateway's name (Gateway API GEP-1762).
func servesGateway(g *gatewayv1.Gateway, namespace string, labels map[string]string) bool {
	return namespace == g.Namespace && labels[gatewayv1.GatewayNameLabelKey] == g.Name
}

func proxyPods(g *gatewayv1.Gateway, pods []*corev1.Pod) []string {
	ids := []string{}
	for _, p := range pods {
		if p.Status.Phase == corev1.PodRunning && servesGateway(g, p.Namespace, p.Labels) {
			ids = append(ids, podID(p.Namespace, p.Name))
		}
	}
	return ids
}

func proxyService(g *gatewayv1.Gateway, services []*corev1.Service) string {
	for _, s := range services {
		if servesGateway(g, s.Namespace, s.Labels) {
			return podID(s.Namespace, s.Name)
		}
	}
	return ""
}

func gatewayAddresses(addresses []gatewayv1.GatewayStatusAddress) []string {
	out := []string{}
	for _, a := range addresses {
		out = append(out, a.Value)
	}
	return out
}

func buildListeners(g *gatewayv1.Gateway) []Listener {
	attached := map[gatewayv1.SectionName]int32{}
	for _, s := range g.Status.Listeners {
		attached[s.Name] = s.AttachedRoutes
	}
	out := make([]Listener, 0, len(g.Spec.Listeners))
	for _, l := range g.Spec.Listeners {
		hostname := "any hostname"
		if l.Hostname != nil {
			hostname = string(*l.Hostname)
		}
		out = append(out, Listener{
			Name:           string(l.Name),
			Protocol:       string(l.Protocol),
			Port:           l.Port,
			Hostname:       hostname,
			AllowedRoutes:  allowedNamespaces(l.AllowedRoutes),
			AttachedRoutes: attached[l.Name],
		})
	}
	return out
}

// allowedNamespaces describes which namespaces may attach routes to a listener; the API default is its own.
func allowedNamespaces(allowed *gatewayv1.AllowedRoutes) string {
	if allowed == nil || allowed.Namespaces == nil || allowed.Namespaces.From == nil {
		return "the Gateway's namespace"
	}
	switch *allowed.Namespaces.From {
	case gatewayv1.NamespacesFromAll:
		return "all namespaces"
	case gatewayv1.NamespacesFromSelector:
		return "namespaces labelled " + metav1.FormatLabelSelector(allowed.Namespaces.Selector)
	case gatewayv1.NamespacesFromNone:
		return "no namespace"
	default:
		return "the Gateway's namespace"
	}
}

// buildRoutes describes each HTTPRoute with its backends and the status its Gateway controller wrote back.
func buildRoutes(routes []*gatewayv1.HTTPRoute) []Route {
	out := make([]Route, 0, len(routes))
	for _, r := range routes {
		accepted, status := routeStatus(r.Status.Parents)
		route := Route{
			ID:        podID(r.Namespace, r.Name),
			Name:      r.Name,
			Namespace: r.Namespace,
			Gateways:  parentGateways(r.Namespace, r.Spec.ParentRefs),
			Hostnames: []string{},
			Backends:  []Backend{},
			Filters:   []string{},
			Accepted:  accepted,
			Status:    status,
		}
		for _, h := range r.Spec.Hostnames {
			route.Hostnames = append(route.Hostnames, string(h))
		}
		for _, rule := range r.Spec.Rules {
			route.Backends = append(route.Backends, ruleBackends(r.Namespace, rule)...)
			for _, f := range rule.Filters {
				route.Filters = append(route.Filters, string(f.Type))
			}
		}
		route.Filters = sortedUnique(route.Filters)
		out = append(out, route)
	}
	slices.SortFunc(out, func(a, b Route) int { return cmp.Compare(a.ID, b.ID) })
	return out
}

// routeStatus reads the conditions every parent Gateway's controller wrote on a route.
func routeStatus(parents []gatewayv1.RouteParentStatus) (accepted bool, status string) {
	if len(parents) == 0 {
		return false, "no status yet: no Gateway controller has processed it"
	}
	status = "Accepted"
	for _, p := range parents {
		if c := meta.FindStatusCondition(p.Conditions, string(gatewayv1.RouteConditionAccepted)); c == nil || c.Status != metav1.ConditionTrue {
			return false, "not accepted: " + conditionReason(c)
		}
		if c := meta.FindStatusCondition(p.Conditions, string(gatewayv1.RouteConditionResolvedRefs)); c != nil && c.Status != metav1.ConditionTrue {
			status = "accepted, but a backend is unresolved: " + c.Reason
		}
	}
	return true, status
}

func conditionReason(c *metav1.Condition) string {
	if c == nil {
		return "no Accepted condition"
	}
	return c.Reason
}

// parentGateways returns the IDs of the Gateways a route attaches to; a parentRef's default kind is Gateway.
func parentGateways(namespace string, refs []gatewayv1.ParentReference) []string {
	ids := []string{}
	for _, ref := range refs {
		if ref.Kind != nil && *ref.Kind != "Gateway" {
			continue
		}
		parentNamespace := namespace
		if ref.Namespace != nil {
			parentNamespace = string(*ref.Namespace)
		}
		ids = append(ids, podID(parentNamespace, string(ref.Name)))
	}
	return ids
}

// ruleBackends returns the Services a rule sends traffic to; a backendRef's default kind is Service.
func ruleBackends(namespace string, rule gatewayv1.HTTPRouteRule) []Backend {
	var backends []Backend
	for _, ref := range rule.BackendRefs {
		if (ref.Group != nil && *ref.Group != "") || (ref.Kind != nil && *ref.Kind != "Service") {
			continue
		}
		serviceNamespace := namespace
		if ref.Namespace != nil {
			serviceNamespace = string(*ref.Namespace)
		}
		var port int32
		if ref.Port != nil {
			port = *ref.Port
		}
		backends = append(backends, Backend{Service: podID(serviceNamespace, string(ref.Name)), Port: port})
	}
	return backends
}

// gatewayLinks connects each Gateway's proxy pods to the pods behind the Services its accepted routes target.
func gatewayLinks(gateways []Gateway, routes []Route, services map[string]Service) []Link {
	var links []Link
	for _, g := range gateways {
		for _, r := range routes {
			if !r.Accepted || !slices.Contains(r.Gateways, g.ID) {
				continue
			}
			for _, target := range routeTargets(r, services) {
				for _, proxy := range g.ProxyPods {
					links = append(links, Link{proxy, target, joinHostnames(r.Hostnames), "gateway"})
				}
			}
		}
	}
	return links
}

// routeTargets returns the ready pods behind every backend of a route.
func routeTargets(r Route, services map[string]Service) []string {
	var pods []string
	for _, b := range r.Backends {
		pods = append(pods, services[b.Service].Pods...)
	}
	return pods
}

func joinHostnames(hostnames []string) string {
	if len(hostnames) == 0 {
		return "any hostname"
	}
	return strings.Join(hostnames, ", ")
}
