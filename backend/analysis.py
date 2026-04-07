from scipy.integrate import dblquad

z1 = 1
z2 = 3

x1 = 2
x2 = 4

area = dblquad(lambda x, y: x*y, 0, 0.5, lambda x: 0, lambda x: 1-2*x)
print(area)

