import { get } from 'svelte/store';
import { posts } from '$lib/stores';

export const getBlogPosts = async (servFetch, bypass = false) => {
	if (get(posts)[0]?.items && !bypass) {
		console.log("[getBlogPosts] Returning cached posts from store");
		return { posts: get(posts), fresh: false };
	}

	const smartFetch = servFetch ?? fetch;

	console.log("[getBlogPosts] Fetching from /api/getBlogPosts...");
	const res = await smartFetch(`/api/getBlogPosts`, { compress: true });

	if (!res.ok) {
		const errs = await res.text();
		console.error("[getBlogPosts] API error:", errs);
		if (get(posts)[0]?.items) {
			return { posts: get(posts), fresh: true };
		}
		return { posts: [], fresh: true };
	}

	// Parse response
	const data = await res.json();
	console.log("[getBlogPosts] Raw response from API:", data);

	// Unwrap items (Contentful wraps entries in .items[])
	const newPosts = data.items || [];
	if (!newPosts.length) {
		console.warn("[getBlogPosts] No posts returned from API.");
		posts.update(() => []);
		return { posts: [], fresh: true };
	}

	// Sort by created date
	const finalPosts = [...newPosts].sort(
		(a, b) => Date.parse(b.sys.createdAt) - Date.parse(a.sys.createdAt)
	);

	// Save to store
	posts.update(() => finalPosts);

	console.log(
		"[getBlogPosts] Final sorted posts summary:",
		finalPosts.map((p) => ({
			id: p.sys.id,
			createdAt: p.sys.createdAt,
			title: p.fields.title,
			featured: p.fields.featured,
		}))
	);

	return { posts: finalPosts, fresh: true };
};

/* ------------------ RICH TEXT HELPERS ------------------ */

export const generateParagraph = (paragraph, indent = true) => {
	let { paragraphText, newIndent } = genElementStart(
		paragraph.nodeType,
		indent,
		paragraph.data.target
	);
	indent = newIndent;

	for (const element of paragraph.content) {
		paragraphText += genContent(element, indent);
	}
	paragraphText += genElementEnd(paragraph.nodeType, indent);

	return paragraphText;
};

const genElementStart = (nodeType, indent, target) => {
	let paragraphText = "";

	switch (nodeType) {
		case "heading-1":
			if (indent) paragraphText = '<h1 class="heading-1">';
			break;
		case "heading-2":
			if (indent) paragraphText = '<h2 class="heading-2">';
			break;
		case "heading-3":
			if (indent) paragraphText = '<h3 class="heading-3">';
			break;
		case "heading-4":
			if (indent) paragraphText = '<h4 class="heading-4">';
			break;
		case "heading-5":
			if (indent) paragraphText = '<h5 class="heading-5">';
			break;
		case "heading-6":
			if (indent) paragraphText = '<h6 class="heading-6">';
			break;
		case "paragraph":
			if (indent) paragraphText = '<p class="bodyParagraph">';
			break;
		case "table":
			paragraphText = "<table>";
			break;
		case "table-row":
			paragraphText = "<tr>";
			break;
		case "table-cell":
			paragraphText = "<td>";
			break;
		case "table-header-cell":
			paragraphText = "<th>";
			break;
		case "unordered-list":
			paragraphText = "<ul>";
			break;
		case "ordered-list":
			paragraphText = "<ol>";
			break;
		case "blockquote":
			paragraphText = "<blockquote>";
			indent = false;
			break;
		case "hr":
			paragraphText = "<hr />";
			break;
		case "embedded-asset-block":
			paragraphText = `<br /><div class="blogImg"><img class="innerImg" src="${getImg(
				target
			)}" alt="${target.fields.title}" /></div>`;
			break;
	}
	return { paragraphText, newIndent: indent };
};

const genElementEnd = (nodeType, indent) => {
	switch (nodeType) {
		case "heading-1":
			return indent ? "</h1>" : "";
		case "heading-2":
			return indent ? "</h2>" : "";
		case "heading-3":
			return indent ? "</h3>" : "";
		case "heading-4":
			return indent ? "</h4>" : "";
		case "heading-5":
			return indent ? "</h5>" : "";
		case "heading-6":
			return indent ? "</h6>" : "";
		case "paragraph":
			return indent ? "</p>" : "";
		case "table":
			return "</table>";
		case "table-row":
			return "</tr>";
		case "table-cell":
			return "</td>";
		case "table-header-cell":
			return "</th>";
		case "unordered-list":
			return "</ul>";
		case "blockquote":
			return "</blockquote>";
		case "ordered-list":
			return "</ol>";
		default:
			return "";
	}
};

const genContent = (element, indent) => {
	let paragraphText = "";

	switch (element.nodeType) {
		case "paragraph":
			return generateParagraph(element, indent);
		case "list-item":
			paragraphText += "<li>";
			paragraphText += generateParagraph(element, false);
			paragraphText += "</li>";
			return paragraphText;
		case "embedded-asset-block":
		case "ordered-list":
		case "unordered-list":
		case "table":
		case "table-row":
		case "table-cell":
		case "table-header-cell":
			return generateParagraph(element, false);
	}

	paragraphText += genOpeningModifiers(element.marks);

	if (element.nodeType == "text") {
		paragraphText += element.value;
	}
	if (element.nodeType == "hyperlink") {
		paragraphText += `<a href="${element.data.uri}" class="blogLink">`;
		paragraphText += generateParagraph(element);
		paragraphText += "</a>";
	}

	paragraphText += genClosingModifiers(element.marks);
	return paragraphText;
};

const getImg = (img) => {
	return `https://${img.fields.file.url.split("//")[1]}?fm=jpg&fl=progressive`;
};

const genOpeningModifiers = (marks) => {
	let modifiers = "";
	if (marks) {
		for (const mark of marks) {
			if (mark.type == "bold") modifiers += "<b>";
			if (mark.type == "italic") modifiers += "<i>";
			if (mark.type == "underline") modifiers += "<u>";
			if (mark.type == "code") modifiers += "<code>";
		}
	}
	return modifiers;
};

const genClosingModifiers = (marks) => {
	let modifiers = "";
	if (marks) {
		for (const mark of marks) {
			if (mark.type == "code") modifiers += "</code>";
			if (mark.type == "underline") modifiers += "</u>";
			if (mark.type == "italic") modifiers += "</i>";
			if (mark.type == "bold") modifiers += "</b>";
		}
	}
	return modifiers;
};
