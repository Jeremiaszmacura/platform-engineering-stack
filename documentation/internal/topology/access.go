package topology

import (
	"slices"
	"strconv"
	"strings"

	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
)

func describeRules(rules []rbacv1.PolicyRule) string {
	parts := make([]string, 0, len(rules))
	for _, r := range rules {
		parts = append(parts, strings.Join(r.Verbs, ",")+" "+strings.Join(slices.Concat(r.Resources, r.NonResourceURLs), ","))
	}
	return strings.Join(parts, "; ")
}

// permissions maps "namespace/serviceaccount" to readable RBAC grants.
func permissions(s Snapshot) map[string][]string {
	rules := map[string][]rbacv1.PolicyRule{}
	for _, r := range s.ClusterRoles {
		rules["ClusterRole/"+r.Name] = r.Rules
	}
	for _, r := range s.Roles {
		rules["Role/"+r.Namespace+"/"+r.Name] = r.Rules
	}
	found := map[string][]string{}
	grant := func(ref rbacv1.RoleRef, namespace, where string, subjects []rbacv1.Subject) {
		key := "ClusterRole/" + ref.Name
		if ref.Kind == "Role" {
			key = "Role/" + namespace + "/" + ref.Name
		}
		text := ref.Kind + " " + ref.Name + " (" + where + "): " + describeRules(rules[key])
		for _, sub := range subjects {
			if sub.Kind == rbacv1.ServiceAccountKind {
				id := podID(sub.Namespace, sub.Name)
				found[id] = append(found[id], text)
			}
		}
	}
	for _, b := range s.ClusterRoleBindings {
		grant(b.RoleRef, "", "cluster-wide", b.Subjects)
	}
	for _, b := range s.RoleBindings {
		grant(b.RoleRef, b.Namespace, "in "+b.Namespace, b.Subjects)
	}
	return found
}

func buildServiceAccounts(accounts []*corev1.ServiceAccount, pods []Pod, perms map[string][]string) []ServiceAccount {
	out := []ServiceAccount{}
	for _, a := range accounts {
		if isSystem(a.Namespace) {
			continue
		}
		sa := ServiceAccount{Name: a.Name, Namespace: a.Namespace, Automount: "not set (true)", UsedBy: []string{}}
		if a.AutomountServiceAccountToken != nil {
			sa.Automount = strconv.FormatBool(*a.AutomountServiceAccountToken)
		}
		for _, p := range pods {
			if p.Namespace == a.Namespace && p.ServiceAccount == a.Name {
				sa.UsedBy = append(sa.UsedBy, p.Name)
				sa.TokenMounted = sa.TokenMounted || p.TokenMounted
			}
		}
		if len(sa.UsedBy) == 0 {
			continue
		}
		sa.Permissions = append([]string{}, perms[podID(a.Namespace, a.Name)]...)
		out = append(out, sa)
	}
	slices.SortFunc(out, func(a, b ServiceAccount) int {
		return strings.Compare(podID(a.Namespace, a.Name), podID(b.Namespace, b.Name))
	})
	return out
}

// buildConfigUses lists the Secrets and ConfigMaps workload pods reference, with key names only.
func buildConfigUses(pods []Pod, refs map[string][]configRef) []ConfigUse {
	type entry struct{ keys, users []string }
	entries := map[[3]string]*entry{}
	for _, p := range pods {
		if isSystem(p.Namespace) {
			continue
		}
		for _, r := range refs[p.ID] {
			id := [3]string{r.kind, p.Namespace, r.name}
			if entries[id] == nil {
				entries[id] = &entry{}
			}
			key := r.key
			if key == "" {
				key = "(all keys)"
			}
			entries[id].keys = append(entries[id].keys, key)
			entries[id].users = append(entries[id].users, p.Name)
		}
	}
	out := make([]ConfigUse, 0, len(entries))
	for id, e := range entries {
		out = append(out, ConfigUse{Kind: id[0], Namespace: id[1], Name: id[2], Keys: sortedUnique(e.keys), UsedBy: sortedUnique(e.users)})
	}
	slices.SortFunc(out, func(a, b ConfigUse) int {
		return strings.Compare(a.Kind+a.Namespace+a.Name, b.Kind+b.Namespace+b.Name)
	})
	return out
}

func buildVolumes(claims []*corev1.PersistentVolumeClaim, volumes []*corev1.PersistentVolume, pods []*corev1.Pod) []Volume {
	byName := map[string]*corev1.PersistentVolume{}
	for _, v := range volumes {
		byName[v.Name] = v
	}
	out := make([]Volume, 0, len(claims))
	for _, c := range claims {
		vol := Volume{Claim: c.Name, Namespace: c.Namespace, Volume: c.Spec.VolumeName, AccessModes: []string{}}
		if c.Spec.StorageClassName != nil {
			vol.StorageClass = *c.Spec.StorageClassName
		}
		if size, ok := c.Status.Capacity[corev1.ResourceStorage]; ok {
			vol.Capacity = size.String()
		}
		for _, m := range c.Spec.AccessModes {
			vol.AccessModes = append(vol.AccessModes, string(m))
		}
		if pv := byName[c.Spec.VolumeName]; pv != nil {
			vol.Node, vol.Path = volumeLocation(pv)
		}
		vol.Pods = claimUsers(c, pods)
		out = append(out, vol)
	}
	slices.SortFunc(out, func(a, b Volume) int {
		return strings.Compare(podID(a.Namespace, a.Claim), podID(b.Namespace, b.Claim))
	})
	return out
}

func claimUsers(c *corev1.PersistentVolumeClaim, pods []*corev1.Pod) []string {
	users := []string{}
	for _, p := range pods {
		for _, v := range p.Spec.Volumes {
			if p.Namespace == c.Namespace && v.PersistentVolumeClaim != nil && v.PersistentVolumeClaim.ClaimName == c.Name {
				users = append(users, p.Name)
			}
		}
	}
	return users
}

// volumeLocation returns the node a PersistentVolume is pinned to and its path there.
func volumeLocation(pv *corev1.PersistentVolume) (node, path string) {
	if a := pv.Spec.NodeAffinity; a != nil && a.Required != nil && len(a.Required.NodeSelectorTerms) > 0 {
		if exprs := a.Required.NodeSelectorTerms[0].MatchExpressions; len(exprs) > 0 {
			node = strings.Join(exprs[0].Values, ",")
		}
	}
	switch {
	case pv.Spec.Local != nil:
		path = pv.Spec.Local.Path
	case pv.Spec.HostPath != nil:
		path = pv.Spec.HostPath.Path
	}
	return node, path
}
