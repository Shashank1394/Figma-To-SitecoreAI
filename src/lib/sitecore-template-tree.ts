/** Public, secret-free representation of a Sitecore template-tree item. */
export type SitecoreTemplateTreeNode = {
  itemId: string;
  name: string;
  path: string;
  hasChildren: boolean;
  templateName: string;
  templateFullName: string;
  selectable: boolean;
  children: SitecoreTemplateTreeNode[];
  childrenLoaded: boolean;
};
